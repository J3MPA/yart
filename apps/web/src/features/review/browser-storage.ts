/**
 * `localStorage`, for state that belongs to one person on one device.
 *
 * Storage can be missing, full, or throw on access in a private window, so
 * every call is guarded. What is kept here is a convenience — which reviews
 * have been seen, which files read — and losing it must degrade to the page
 * working without it, never to a page that does not render.
 */
export const readStored = <Value>(key: string, fallback: Value): Value => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Value) : fallback
  } catch {
    return fallback
  }
}

export const writeStored = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Nothing to do: the state stays in memory for this visit.
  }
}
