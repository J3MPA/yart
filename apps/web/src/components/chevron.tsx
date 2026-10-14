import styles from './chevron.module.css'

export interface ChevronProps {
  expanded: boolean
}

/**
 * An open or closed marker for all items that fold.
 *
 * It is a drawn shape, not a character. At the text size of the tree, the small
 * Unicode triangles become dots. The weight of a character depends on the font
 * that supplies it. One shape that turns also looks like the same control in the
 * two places that use it.
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
