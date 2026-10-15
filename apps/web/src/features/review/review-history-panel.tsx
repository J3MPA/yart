import { describeAuthor, submissionAuthor, type Review } from '@yart/core'
import { AttachmentList } from './attachments'
import { AuthorLabel } from './author-label'
import { scrollToFile } from './file-anchors'
import { relativeTime, VERDICT_LABEL } from './format'
import { buildHistory, type HistoryBlock } from './review-history'
import styles from './review.module.css'

export interface ReviewHistoryPanelProps {
  review: Review
  /** Tells if the panel is open when it first shows. */
  open: boolean
}

const heading = (block: HistoryBlock): string => {
  if (block.kind === 'before') return 'Before the first verdict'
  if (block.kind === 'since') return 'After the last verdict'
  const submission = block.submission
  if (submission === null) return ''
  const round = block.round === null ? '' : `Round ${block.round} · `
  const by =
    submissionAuthor(submission) === 'reviewer'
      ? describeAuthor('reviewer', submission.author_name)
      : 'you'
  return `${round}${VERDICT_LABEL[submission.verdict]} · by ${by} · ${relativeTime(submission.created_at)}`
}

/**
 * The full conversation of a review, verdict by verdict.
 *
 * This shows each verdict and its comments, and the answers of the agent, in
 * the order that they occurred. Thus the person can read the exchange of the
 * earlier rounds before they give the next verdict. The diff still shows each
 * thread at its line.
 */
export const ReviewHistoryPanel = ({ review, open }: ReviewHistoryPanelProps) => {
  const blocks = buildHistory(review)

  return (
    <details className={styles.history} open={open}>
      <summary className={styles.history_summary}>Review history</summary>
      {blocks.map((block) => (
        <section
          key={block.submission?.id ?? block.kind}
          className={[
            styles.history_block,
            block.submission !== null && submissionAuthor(block.submission) === 'reviewer'
              ? styles.history_block_reviewer
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className={styles.verdict_label}>{heading(block)}</div>
          {block.submission?.body !== null && block.submission?.body !== undefined && (
            <div className={styles.verdict_body}>{block.submission.body}</div>
          )}
          <AttachmentList review_id={review.id} attachments={block.submission?.attachments} />
          {block.entries.map(({ comment, path, location }) => (
            <div key={comment.id} className={styles.history_entry}>
              <div className={styles.history_entry_head}>
                <AuthorLabel author={comment.author} author_name={comment.author_name} />
                {path !== null && location !== null && (
                  <button
                    type="button"
                    className={styles.history_location}
                    onClick={() => scrollToFile(path)}
                  >
                    {location}
                  </button>
                )}
              </div>
              <div className={styles.comment_body}>{comment.body}</div>
              <AttachmentList review_id={review.id} attachments={comment.attachments} />
            </div>
          ))}
        </section>
      ))}
    </details>
  )
}
