import { useState } from 'react'

/**
 * Manages the app-wide colour theme.
 *
 * The initial value is read from the <html data-theme="…"> attribute that
 * the inline script in index.html already set synchronously — so there is
 * no useEffect + re-render cycle and no flash of the wrong theme.
 * (rerender-lazy-state-init, rendering-hydration-no-flicker)
 *
 * The toggle writes to the DOM attribute, localStorage, and React state
 * all in one event handler — no state+effect cycle needed.
 * (rerender-move-effect-to-event)
 *
 * @returns {{ theme: 'light'|'dark', toggleTheme: Function }}
 */
export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? 'light'
  )

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  return { theme, toggleTheme }
}
