import type { Review } from '@yart/core'
import { descriptionBlocks } from './description-blocks'
import { MarkdownBody } from './markdown-body'
import styles from './review-description.module.css'

export interface ReviewDescriptionProps {
  review: Review
}

/**
 * What the agent said about its change: what changed, what it tested, and
 * where the risk is. The agent writes Markdown, as in its comments.
 */
export const ReviewDescription = ({ review }: ReviewDescriptionProps) => {
  const blocks = descriptionBlocks(review)
  if (blocks.length === 0) return null

  return (
    <div className={styles.description}>
      {blocks.map((block) => (
        <details key={block.label} open={!block.collapsed}>
          <summary className={styles.label}>{block.label}</summary>
          <div className={styles.body}>
            <MarkdownBody text={block.body} />
          </div>
        </details>
      ))}
    </div>
  )
}
