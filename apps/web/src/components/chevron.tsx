import styles from './chevron.module.css'

export interface ChevronProps {
  expanded: boolean
}

/**
 * An open/closed marker for anything that folds.
 *
 * Drawn rather than typed: the Unicode small triangles collapse to dots at the
 * tree's text size, and a glyph's weight depends on whichever font happens to
 * supply it. One shape, rotated, also reads as the same control in both places
 * it is used.
 */
export const Chevron = ({ expanded }: ChevronProps) => (
  <svg
    className={[styles.chevron, expanded ? styles.expanded : ''].filter(Boolean).join(' ')}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
)
