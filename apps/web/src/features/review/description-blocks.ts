import { reviewDescriptions, type Review } from '@yart/core'

/** One description of the agent, as the review page shows it. */
export interface DescriptionBlock {
  label: string
  body: string
  /** A closed block shows only its label until the person opens it. */
  collapsed: boolean
}

/**
 * The descriptions to show under the header of the review page.
 *
 * In a later round, the person wants to know what changed in this round first.
 * The description of the review stays available, but closed. When the current
 * round has no description, the description of the review stays open.
 */
export const descriptionBlocks = (review: Review): DescriptionBlock[] => {
  const descriptions = reviewDescriptions(review)
  const blocks: DescriptionBlock[] = []
  if (descriptions.round !== null) {
    blocks.push({ label: 'What changed in this round', body: descriptions.round, collapsed: false })
  }
  if (descriptions.review !== null) {
    blocks.push({
      label: 'Description of the review',
      body: descriptions.review,
      collapsed: descriptions.round !== null,
    })
  }
  return blocks
}
