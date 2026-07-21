/** Colour-scheme preference. Device-level (localStorage), NOT per-conference —
 *  so it lives here, not in the journal. 'system' follows the OS; light/dark
 *  force. Applied as data-theme on <html>; the CSS decides the rest. */

const KEY = 'ss:theme'
export const THEMES = ['system', 'light', 'dark']

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'system'
  document.documentElement.setAttribute('data-theme', value)
  try { localStorage.setItem(KEY, value) } catch { /* storage off; runtime only */ }
  return value
}
