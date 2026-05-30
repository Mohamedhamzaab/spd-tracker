// ---------------------------------------------------------------------------
//  Theme. Light (default) or dark, switchable and persisted in localStorage.
//  Applied by setting <html data-theme="dark">; styles.css holds the dark
//  token overrides. First load honours a saved choice, else the OS
//  preference.
// ---------------------------------------------------------------------------
const STORE_KEY = 'spd_theme';
const listeners = new Set();

function detectInitial() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* localStorage may be blocked */ }
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch { /* no matchMedia */ }
  return 'light';
}

let current = detectInitial();

function apply(theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

// Apply immediately on import so there is no flash of the wrong theme.
apply(current);

export function getTheme() {
  return current;
}

export function setTheme(theme) {
  current = theme === 'dark' ? 'dark' : 'light';
  apply(current);
  try { localStorage.setItem(STORE_KEY, current); } catch { /* */ }
  listeners.forEach((fn) => fn(current));
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark');
  return current;
}

// Subscribe to theme changes (so React components can re-render their toggle).
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
