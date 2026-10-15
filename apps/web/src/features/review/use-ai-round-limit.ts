import { DEFAULT_SETTINGS } from '@yart/core'
import { useGetSettingsQuery } from './review-api'

/** How many verdicts an AI reviewer can give on a review. The default applies until the settings come. */
export const useAiRoundLimit = (): number => {
  const { data } = useGetSettingsQuery()
  return data?.ai_review_rounds ?? DEFAULT_SETTINGS.ai_review_rounds
}
