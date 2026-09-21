import { Logo } from '@/components/logo'
import { ReviewList } from '@/features/review/review-list'
import { ReviewPage } from '@/features/review/review-page'
import styles from './app.module.css'

/**
 * Reads the review id out of the path.
 *
 * There is no router library: the app has two views, and the daemon already
 * falls back to index.html for unknown paths, so a deep link works without one.
 */
const reviewIdFromPath = (pathname: string): string | null => {
  const match = /^\/reviews\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] ?? null
}

export const App = () => {
  const review_id = reviewIdFromPath(window.location.pathname)

  return (
    <main className={styles.shell}>
      {review_id === null ? (
        <>
          <h1 className={styles.title}>
            <Logo size={30} />
            yart
          </h1>
          <p className={styles.tagline}>Local, GitHub-style code review for AI-generated diffs.</p>
          <ReviewList />
        </>
      ) : (
        <ReviewPage review_id={review_id} />
      )}
    </main>
  )
}

export default App
