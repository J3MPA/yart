import { useEffect, useMemo } from 'react'
import { agentActivity } from '@yart/core'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { useListReviewsQuery } from './review-api'
import { isUnseen } from './seen-reviews'
import { deletedReviewsForgotten } from './local-review-slice'
import { missingForgotten } from './seen-slice'

/**
 * How often the list is re-read.
 *
 * The signal exists to be noticed while attention is elsewhere, and a page
 * nobody is looking at never regains focus — so refetching on focus, which is
 * how the rest of the app stays current, cannot deliver it. Ten seconds against
 * a daemon on localhost is nothing, and browsers throttle timers in hidden tabs
 * anyway, which is the case that matters here.
 */
export const POLL_MS = 10_000

export interface Unseen {
  ids: ReadonlySet<string>
  count: number
  /** Each unseen review's title, for anything announcing it outside the page. */
  titles: ReadonlyMap<string, string>
  /** Whether the list has arrived; until then nothing is unseen for want of reviews. */
  loaded: boolean
}

/** Reviews the agent has touched since they were last looked at. */
export const useUnseenReviews = (): Unseen => {
  const dispatch = useAppDispatch()
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit Query's option name
  const { data } = useListReviewsQuery(false, { pollingInterval: POLL_MS })
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit Query's option name
  const archived = useListReviewsQuery(true, { pollingInterval: POLL_MS })
  const seen = useAppSelector((state) => state.seen)

  const reviews = useMemo(() => data ?? [], [data])

  // State kept for deleted reviews would otherwise outlive them for as long as
  // the browser profile lives. Only pruned once both lists have loaded, and
  // against both: a review missing from the active list may just be archived,
  // and pruning it then would throw away its drafts.
  useEffect(() => {
    if (data === undefined || archived.data === undefined) return
    const ids = [...data, ...archived.data].map((review) => review.id)
    dispatch(missingForgotten(ids))
    dispatch(deletedReviewsForgotten(ids))
  }, [data, archived.data, dispatch])

  return useMemo(() => {
    const unseen = reviews.filter((review) => isUnseen(seen, review.id, agentActivity(review)))
    const titles = new Map(unseen.map((review) => [review.id, review.title]))
    return { ids: new Set(titles.keys()), count: titles.size, titles, loaded: data !== undefined }
  }, [reviews, seen, data])
}
