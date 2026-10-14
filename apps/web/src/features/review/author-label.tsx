import { describeAuthor, type Comment } from '@yart/core'
import styles from './review.module.css'

export interface AuthorLabelProps {
  author: Comment['author']
  author_name?: string | null
}

/** Who wrote a comment. An AI reviewer looks different from the agent that it reviews. */
export const AuthorLabel = ({ author, author_name }: AuthorLabelProps) => (
  <div
    className={[styles.comment_author, author === 'reviewer' ? styles.comment_author_reviewer : '']
      .filter(Boolean)
      .join(' ')}
  >
    {describeAuthor(author, author_name)}
  </div>
)
