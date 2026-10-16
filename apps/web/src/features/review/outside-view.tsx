import type { Thread } from '@yart/core'
import { Button } from '@/components/button'
import { CommentThread } from './comment-thread'
import type { Drafting } from './drafts'
import styles from './review.module.css'

export interface OutsideViewProps {
  review_id: string
  threads: readonly Thread[]
  drafting: Drafting
  onShowAll: () => void
}

const location = (thread: Thread): string => {
  const anchor = thread.anchor ?? thread.origin
  return `${anchor.path}:${anchor.line}`
}

/** The open threads that the "since" view has no row for. */
export const OutsideView = ({ review_id, threads, drafting, onShowAll }: OutsideViewProps) => (
  <section className={styles.outside} aria-label="Open comments outside this view">
    <div className={styles.outside_header}>
      <span className={styles.outside_label}>
        {threads.length} open comment{threads.length === 1 ? ' is' : 's are'} outside this view
      </span>
      <span className={styles.spacer} />
      <Button tone="quiet" onClick={onShowAll}>
        Show all changes
      </Button>
    </div>
    {threads.map((thread) => (
      <div key={thread.id}>
        <div className={styles.outdated_context}>
          {location(thread)} · {thread.context.line}
        </div>
        <CommentThread review_id={review_id} thread={thread} drafting={drafting} />
      </div>
    ))}
  </section>
)
