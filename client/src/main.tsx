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

// Color tokens live in index.css so both themes share one source of truth.
const darkStyle = document.createElement('style');
darkStyle.setAttribute('data-theme-css', 'true');
darkStyle.textContent = `
[data-theme="dark"] .preview-panel::backdrop { background: rgba(0,0,0,0.85); }
[data-theme="dark"] .drag-overlay { background: rgba(0,0,0,0.85); }
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
