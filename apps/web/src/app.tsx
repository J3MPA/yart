import { Logo } from '@/components/logo'
import { useUnseenReviews } from '@/features/review/use-unseen'
import { useUnseenSignal } from '@/features/review/use-unseen-signal'
import { useDesktopSignal } from '@/features/review/use-desktop-signal'
import { useGetVersionQuery } from '@/features/review/review-api'
import { ReviewList } from '@/features/review/review-list'
import { ReviewPage } from '@/features/review/review-page'
import { SettingsPage } from '@/features/settings/settings-page'
import styles from './app.module.css'

/**
 * Reads the review id from the path.
 *
 * There is no router library. The app has few views, and the daemon already
 * sends index.html for unknown paths. Thus a link to a review works without a
 * router.
 */
const reviewIdFromPath = (pathname: string): string | null => {
  const match = /^\/reviews\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] ?? null
}

export const App = () => {
  const review_id = reviewIdFromPath(window.location.pathname)
  const on_settings = /^\/settings\/?$/.test(window.location.pathname)
  // Kept here, not in the list, because the tab must also show the count while
  // one review is open.
  const unseen = useUnseenReviews()
  useUnseenSignal(unseen.count)
  useDesktopSignal(unseen)
  const { data: version } = useGetVersionQuery()

  return (
    <main className={styles.shell}>
      {on_settings ? (
        <SettingsPage />
      ) : review_id === null ? (
        <>
          <h1 className={styles.title}>
            <Logo size={30} />
            yart
            <a className={styles.settings_link} href="/settings">
              Settings
            </a>
          </h1>
          <p className={styles.tagline}>Local, GitHub-style code review for AI-generated diffs.</p>
          <ReviewList unseen={unseen.ids} />
        </>
      ) : (
        <ReviewPage review_id={review_id} />
      )}
      {version !== undefined && <footer className={styles.version}>yart {version.version}</footer>}
    </main>
  )
}

export default App
