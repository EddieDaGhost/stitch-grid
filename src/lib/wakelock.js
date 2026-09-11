/**
 * Keeping the screen awake while you crochet. DOM.
 *
 * A row takes minutes, not seconds, and both hands are holding yarn — so the screen
 * blanks constantly, and waking it means putting the hook down and finding a clean
 * finger. This is a small API for a disproportionately large irritation.
 *
 * Everything here is best-effort by design. `navigator.wakeLock` is missing on some
 * browsers, rejects outright on others (an iframe, an insecure origin, a battery-saver
 * mode), and the system drops the lock on its own whenever the tab is hidden. None of
 * that is worth an error message, so every path resolves quietly and the caller is told
 * only whether a lock is actually held.
 */

const supported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator

export function wakeLockSupported() {
  return supported()
}

/**
 * Hold the screen awake until the returned function is called.
 *
 * Re-acquires when the tab comes back, because the system silently releases the lock on
 * every visibility change — without that, the lock survives exactly until the first
 * time you switch apps to look something up, which is to say it never works when it
 * matters.
 *
 * @param {(held: boolean) => void} [onChange] called whenever the lock is gained or lost
 * @returns {() => void} release
 */
export function holdScreenAwake(onChange) {
  if (!supported()) {
    onChange?.(false)
    return () => {}
  }

  let sentinel = null
  let released = false
  const report = (held) => onChange?.(held)

  const acquire = async () => {
    if (released || sentinel) return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      if (released) {
        sentinel.release?.()
        sentinel = null
        return
      }
      sentinel.addEventListener?.('release', () => {
        sentinel = null
        if (!released) report(false)
      })
      report(true)
    } catch {
      sentinel = null
      report(false)
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire()
  }

  document.addEventListener('visibilitychange', onVisible)
  acquire()

  return () => {
    released = true
    document.removeEventListener('visibilitychange', onVisible)
    sentinel?.release?.()
    sentinel = null
    report(false)
  }
}
