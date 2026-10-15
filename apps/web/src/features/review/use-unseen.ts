import { useEffect, useMemo } from 'react'
import { agentActivity, DEFAULT_SETTINGS } from '@yart/core'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { isPersonsTurn } from './format'
import { useGetSettingsQuery, useListReviewsQuery } from './review-api'
import { isUnseen } from './seen-reviews'
import { deletedReviewsForgotten } from './local-review-slice'
import { missingForgotten } from './seen-slice'

/**
 * How frequently the page reads the list again.
 *
 * The signal must get your attention while you look at something else. A page
 * that nobody looks at never gets focus again. The rest of the app gets new data
 * on focus, but that cannot give this signal. A request every ten seconds to a
 * daemon on localhost costs nothing. Also, browsers slow the timers in hidden
 * tabs, and this signal is for those tabs.
 */
export const POLL_MS = 10_000

export interface Unseen {
  ids: ReadonlySet<string>
  count: number
  /** The title of each review that waits on the person, for signals outside the page. */
  waiting: ReadonlyMap<string, string>
  /**
   * Tells if the list and the settings came. Before the list comes, nothing is
   * unseen, because there are no reviews. Before the settings come, the round
   * limit of the AI reviewer is not known.
   */
  loaded: boolean
}

/**
 * The reviews that the agent touched after the person last looked at them,
 * and the reviews that wait on the person.
 */
export const useUnseenReviews = (): Unseen => {
  const dispatch = useAppDispatch()
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit Query's option name
  const { data } = useListReviewsQuery(false, { pollingInterval: POLL_MS })
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit Query's option name
  const archived = useListReviewsQuery(true, { pollingInterval: POLL_MS })
  const seen = useAppSelector((state) => state.seen)
  const settings = useGetSettingsQuery()
  const round_limit = settings.data?.ai_review_rounds ?? DEFAULT_SETTINGS.ai_review_rounds
  const settings_loaded = !settings.isLoading

  const reviews = useMemo(() => data ?? [], [data])

  // Without this, the state of deleted reviews would stay for as long as the
  // browser profile exists. Remove it only after the two lists loaded, and
  // against the two. A review that is not in the active list can be archived.
  // A removal then would delete its drafts.
  useEffect(() => {
    if (data === undefined || archived.data === undefined) return
    const ids = [...data, ...archived.data].map((review) => review.id)
    dispatch(missingForgotten(ids))
    dispatch(deletedReviewsForgotten(ids))
  }, [data, archived.data, dispatch])

  return useMemo(() => {
    const ids = new Set(
      reviews
        .filter((review) => isUnseen(seen, review.id, agentActivity(review)))
        .map((review) => review.id),
    )
    const waiting = new Map(
      reviews
        .filter((review) => isPersonsTurn(review, round_limit))
        .map((review) => [review.id, review.title]),
    )
    return { ids, count: ids.size, waiting, loaded: data !== undefined && settings_loaded }
  }, [reviews, seen, data, round_limit, settings_loaded])
}
