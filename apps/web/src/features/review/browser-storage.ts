/**
 * `localStorage`, for state that belongs to one person on one device.
 *
 * Storage can be missing or full, or can fail in a private window. Thus each
 * call has a guard. The data here is a convenience: which reviews you saw, and
 * which files you read. If it is lost, the page must work without it. The page
 * must never fail to show.
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
    // Nothing to do. The state stays in memory for this visit.
  }
}
