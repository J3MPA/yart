import { useMemo, useState } from 'react'
import {
  gapLines,
  gapSlice,
  hunkSectionHeading,
  planDiffSections,
  splitLines,
  type DiffGap,
  type DiffLine,
  type FileDiff,
  type Thread,
} from '@yart/core'
import { CommentThread } from './comment-thread'
import { DiffRow, type PendingComment, type RowTarget } from './diff-row'
import { fileAnchorId } from './file-anchors'
import { EXPAND_STEP, GapBand, type GapEdge } from './gap-band'
import { useAddThreadMutation, useGetReviewFileQuery } from './review-api'
import { describeQueryError } from './query-error'
import { outdatedThreadsForPath } from './thread-anchors'
import styles from './review.module.css'

export type { PendingComment } from './diff-row'

export interface DiffFileProps {
  review_id: string
  file: FileDiff
  threads: readonly Thread[]
  threads_by_anchor: ReadonlyMap<string, Thread[]>
  pending: PendingComment | null
  onPendingChange: (pending: PendingComment | null) => void
}

/** How much of one collapsed run has been opened, from each end. */
interface GapExpansion {
  top: number
  bottom: number
}

const CLOSED: GapExpansion = { top: 0, bottom: 0 }

export const DiffFile = ({
  review_id,
  file,
  threads,
  threads_by_anchor,
  pending,
  onPendingChange,
}: DiffFileProps) => {
  const [addThread, add_state] = useAddThreadMutation()
  const [expanded, setExpanded] = useState<ReadonlyMap<number, GapExpansion>>(new Map())

  const outdated = outdatedThreadsForPath(threads, file.path)
  const sections = useMemo(
    () => planDiffSections(file.hunks, file.head_line_count),
    [file.hunks, file.head_line_count],
  )

  // The whole file is only worth fetching once something has been opened; until
  // then the hunks are all there is to draw.
  const contents_query = useGetReviewFileQuery(
    { review_id, path: file.path },
    { skip: expanded.size === 0 },
  )
  const head_lines = useMemo(() => {
    const content = contents_query.data?.head_content
    return content === undefined || content === null ? null : splitLines(content)
  }, [contents_query.data])

  const expand = (gap: DiffGap, edge: GapEdge) =>
    setExpanded((previous) => {
      const current = previous.get(gap.head_start) ?? CLOSED
      const step = Math.min(EXPAND_STEP, gap.length - current.top - current.bottom)
      if (step <= 0) return previous
      const next = new Map(previous)
      next.set(
        gap.head_start,
        edge === 'top'
          ? { ...current, top: current.top + step }
          : { ...current, bottom: current.bottom + step },
      )
      return next
    })

  const addThreadAt = (target: RowTarget, body: string) =>
    void addThread({ review_id, path: file.path, line: target.line, side: target.side, body })

  const row = (line: DiffLine, key: string) => (
    <DiffRow
      key={key}
      review_id={review_id}
      file_path={file.path}
      line={line}
      threads_by_anchor={threads_by_anchor}
      pending={pending}
      adding={add_state.isLoading}
      onPendingChange={onPendingChange}
      onAddThread={addThreadAt}
    />
  )

  return (
    <section className={styles.file} id={fileAnchorId(file.path)}>
      <header className={styles.file_header}>
        <span className={styles.file_status}>{file.status}</span>
        <span className={styles.file_path}>{file.path}</span>
        {file.old_path !== null && <span className={styles.file_status}>was {file.old_path}</span>}
      </header>

      {outdated.length > 0 && (
        <div className={styles.outdated}>
          <div className={styles.outdated_label}>
            {outdated.length} comment{outdated.length === 1 ? '' : 's'} on lines that no longer
            exist
          </div>
          {outdated.map((thread) => (
            <div key={thread.id}>
              <div className={styles.outdated_context}>{thread.context.line}</div>
              <CommentThread review_id={review_id} thread={thread} />
            </div>
          ))}
        </div>
      )}

      {file.is_binary && <p className={styles.binary}>Binary file — not shown.</p>}

      {sections.map((section, index) => {
        if (section.kind === 'hunk') {
          return (
            <div key={`hunk-${section.index}`}>
              {section.hunk.lines.map((line, line_index) =>
                row(line, `hunk-${section.index}-${line_index}`),
              )}
            </div>
          )
        }

        const { gap } = section
        const state = expanded.get(gap.head_start) ?? CLOSED
        const hidden = gap.length - state.top - state.bottom
        const awaiting = state.top + state.bottom > 0 && head_lines === null
        const failed = contents_query.isError
          ? describeQueryError(contents_query.error).message
          : null

        const top = head_lines === null ? [] : gapLines(gapSlice(gap, 0, state.top), head_lines)
        const bottom =
          head_lines === null
            ? []
            : gapLines(gapSlice(gap, gap.length - state.bottom, state.bottom), head_lines)

        // The band carries the following hunk's heading, so it has to know what
        // comes next; a run at the end of a file has nothing to name.
        const next = sections[index + 1]
        const heading =
          next === undefined || next.kind !== 'hunk' ? '' : hunkSectionHeading(next.hunk.header)

        return (
          <div key={`gap-${gap.head_start}`}>
            {top.map((line) => row(line, `gap-${line.head_line ?? 0}`))}
            {(hidden > 0 || awaiting || failed !== null) && (
              <GapBand
                gap={gapSlice(gap, state.top, hidden)}
                heading={heading}
                loading={awaiting && failed === null}
                error={failed}
                onExpand={(edge) => expand(gap, edge)}
              />
            )}
            {bottom.map((line) => row(line, `gap-${line.head_line ?? 0}`))}
          </div>
        )
      })}
    </section>
  )
}
