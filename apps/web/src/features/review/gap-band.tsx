import type { DiffGap } from '@yart/core'
import styles from './review.module.css'

/** How many lines one click reveals. Enough to see a function, short enough to aim. */
export const EXPAND_STEP = 20

export type GapEdge = 'top' | 'bottom'

export interface GapBandProps {
  /** What is still hidden, which shrinks as the run is opened from either end. */
  gap: DiffGap
  /** The enclosing context git named for the hunk below, if it named one. */
  heading: string
  loading: boolean
  error: string | null
  onExpand: (edge: GapEdge) => void
}

/**
 * The seam where a diff skips unchanged lines.
 *
 * It stands in for the `@@` header rather than sitting beside one: the header's
 * line numbers duplicate the gutters, and its only unique content — the
 * enclosing function git names — belongs with the lines it describes. Once a
 * run is fully open there is no seam left, so nothing is drawn at all.
 */
export const GapBand = ({ gap, heading, loading, error, onExpand }: GapBandProps) => {
  const hidden = gap.length
  const step = Math.min(EXPAND_STEP, hidden)
  const by_ends = hidden > EXPAND_STEP

  return (
    <div className={styles.gap}>
      <span className={styles.gap_controls}>
        {by_ends ? (
          <>
            <button
              type="button"
              className={styles.gap_button}
              disabled={loading}
              aria-label={`Show ${step} lines from the top of this run`}
              onClick={() => onExpand('top')}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.gap_button}
              disabled={loading}
              aria-label={`Show ${step} lines from the bottom of this run`}
              onClick={() => onExpand('bottom')}
            >
              ↓
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.gap_button}
            disabled={loading || hidden === 0}
            aria-label={`Show the remaining ${hidden} unchanged lines`}
            onClick={() => onExpand('top')}
          >
            ⋯
          </button>
        )}
      </span>

      <span className={styles.gap_label}>
        {error !== null
          ? `Could not load the rest of this file: ${error}`
          : loading
            ? 'Loading…'
            : `${hidden} unchanged line${hidden === 1 ? '' : 's'}`}
      </span>
      <span className={styles.gap_heading}>{heading}</span>
      <span className={styles.gap_lines}>
        {gap.head_start}–{gap.head_start + gap.length - 1}
      </span>
    </div>
  )
}
