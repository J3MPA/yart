import styles from './comment-icon.module.css'

/**
 * Marks an item that has a conversation that is still open.
 *
 * A mark, not a count. When you look at a list to find where to go next, the
 * signal is that an open thread exists. How many is a detail. The tooltip shows
 * it, and the rows do not become wider.
 */
export const CommentIcon = () => (
  <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 2.75h10A1.25 1.25 0 0 1 14.25 4v6.5A1.25 1.25 0 0 1 13 11.75H7.5L4.25 14.25v-2.5H3A1.25 1.25 0 0 1 1.75 10.5V4A1.25 1.25 0 0 1 3 2.75Z" />
  </svg>
)
