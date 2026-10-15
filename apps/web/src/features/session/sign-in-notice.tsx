import { useEffect } from 'react'
import styles from './sign-in-notice.module.css'

/**
 * Shows what to do when the daemon refuses this window. The desktop app signs
 * in again by itself. A browser needs a new sign-in link.
 */
export const SignInNotice = () => {
  const bridge = window.yart_desktop
  const can_sign_in = bridge?.signIn !== undefined

  useEffect(() => {
    bridge?.signIn?.()
  }, [bridge])

  return (
    <section className={styles.notice}>
      <h1 className={styles.title}>Sign in to yart</h1>
      {can_sign_in ? (
        <p>The app signs in again.</p>
      ) : (
        <>
          <p>
            yart shows reviews only in a window that signed in. Run this command in a terminal. It
            opens a sign-in link in your browser:
          </p>
          <pre className={styles.command}>yart open</pre>
        </>
      )}
    </section>
  )
}
