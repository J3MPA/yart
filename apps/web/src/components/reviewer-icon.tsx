import styles from './reviewer-icon.module.css'

/** Marks the work of an AI reviewer. Thus you can tell it apart from your own verdict. */
export const ReviewerIcon = () => (
  <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 1.75 9.4 6.6 14.25 8 9.4 9.4 8 14.25 6.6 9.4 1.75 8 6.6 6.6Z" />
  </svg>
)
