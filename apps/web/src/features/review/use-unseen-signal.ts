import { useEffect } from 'react'

const BASE_TITLE = 'yart'
const PLAIN_ICON = '/favicon.svg'
const ALERT_ICON = '/favicon-unseen.svg'

const setIcon = (href: string): void => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link !== null && link.href !== new URL(href, window.location.origin).href) {
    link.href = href
  }
}

/**
 * Puts the count where it can be seen from outside the page.
 *
 * Both the title and the favicon, because neither is enough on its own: a
 * pinned tab shows no title, and a tab among twenty shows a favicon too small
 * to read a number on. Together they cover how the tab is actually being kept.
 */
export const useUnseenSignal = (count: number): void => {
  useEffect(() => {
    document.title = count === 0 ? BASE_TITLE : `(${count}) ${BASE_TITLE}`
    setIcon(count === 0 ? PLAIN_ICON : ALERT_ICON)
  }, [count])
}
