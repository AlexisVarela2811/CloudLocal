import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const THEME_KEY = 'cloudlocal-theme';

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
}

function initTheme() {
  const saved = (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || null;
  if (saved) {
    applyTheme(saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark');
  }
}

initTheme();

// Inject dark-mode CSS variable overrides
const darkStyle = document.createElement('style');
darkStyle.setAttribute('data-theme-css', 'true');
darkStyle.textContent = `
[data-theme="dark"] {
  --bg:             #0d1117;
  --surface:        #161b22;
  --text:           #e6edf3;
  --muted:          #8b949e;
  --muted2:         #6e7681;
  --line:           #21262d;
  --line2:          #161b22;
  --sidebar:        #010409;
  --sidebar2:       #161b22;
  --sidebar-text:   #8b949e;
  --sidebar-active: #21262d;
  --sidebar-hover:  #161b22;
  --accent:         #3fb950;
  --accent2:        #56d364;
  --accent-bg:      rgba(63, 185, 80, 0.08);
  --accent-hover:   rgba(63, 185, 80, 0.14);
  --accent-light:   rgba(63, 185, 80, 0.05);
  --danger:         #f85149;
  --danger-bg:      rgba(248, 81, 73, 0.06);
  --danger-hover:   rgba(248, 81, 73, 0.12);
}
[data-theme="dark"] .sidebar { background: var(--sidebar); }
[data-theme="dark"] .sidebar-toggle { color: var(--sidebar-text); }
[data-theme="dark"] .sidebar-overlay { background: rgba(0,0,0,0.6); }
[data-theme="dark"] .preview-panel::backdrop { background: rgba(0,0,0,0.85); }
[data-theme="dark"] .drag-overlay { background: rgba(0,0,0,0.85); }
[data-theme="dark"] .access-shell { background: var(--sidebar); }
`;
document.head.appendChild(darkStyle);

// Listen for theme changes from Settings or external callers
window.addEventListener('cloudlocal-theme-change', (e: Event) => {
  const detail = (e as CustomEvent).detail as { theme: 'dark' | 'light' } | undefined;
  if (detail?.theme) applyTheme(detail.theme);
});


/** Toggle between dark and light themes. Returns the new theme value. */
export function toggleTheme(): 'dark' | 'light' {
  const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | undefined;
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
  window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme: next } }));
  return next;
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
