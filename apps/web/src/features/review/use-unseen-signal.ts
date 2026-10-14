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
 * Puts the count where you can see it from outside the page.
 *
 * The title and the favicon, because one alone is not sufficient. A pinned tab
 * shows no title. In a row of twenty tabs, a favicon is too small for a number.
 * Together, they cover the ways that people keep the tab.
 */
export const useUnseenSignal = (count: number): void => {
  useEffect(() => {
    document.title = count === 0 ? BASE_TITLE : `(${count}) ${BASE_TITLE}`
    setIcon(count === 0 ? PLAIN_ICON : ALERT_ICON)
  }, [count])
}
