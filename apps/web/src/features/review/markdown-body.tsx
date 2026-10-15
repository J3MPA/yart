import { lazy, Suspense } from 'react'
import styles from './markdown-body.module.css'

export interface MarkdownBodyProps {
  text: string
}

const PlainText = ({ text }: MarkdownBodyProps) => <p>{text}</p>

/**
 * The Markdown parser is a large part of the code of the page. Thus it is a
 * separate chunk. The page shows the plain text until the chunk comes. If the
 * chunk does not come, for example after an update of the daemon, the plain
 * text stays.
 */
const MarkdownRender = lazy(() =>
  import('./markdown-render').then(
    (module) => ({ default: module.MarkdownRender }),
    () => ({ default: PlainText }),
  ),
)

/** Text that a person or an agent wrote, with a safe subset of Markdown. */
export const MarkdownBody = ({ text }: MarkdownBodyProps) => (
  <div className={styles.markdown}>
    <Suspense fallback={<PlainText text={text} />}>
      <MarkdownRender text={text} />
    </Suspense>
  </div>
)
