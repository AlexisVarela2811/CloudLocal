import { useState, useEffect } from 'react';
import { api, type SettingsInfo, failure } from '../api/api';

interface SettingsPanelProps {
  onExpired?: () => void;
}

const THEME_KEY = 'cloudlocal-theme';

function getSavedTheme(): 'dark' | 'light' {
  return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'light';
}

function setSavedTheme(theme: 'dark' | 'light') {
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme } }));
}

export function SettingsPanel({ onExpired }: SettingsPanelProps) {
  const [data, setData] = useState<SettingsInfo | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => getSavedTheme() === 'dark');

  useEffect(() => {
    let active = true;
    api.settings().then(value => {
      if (!active) return;
      setData(value);
      setInput(value.folderPath || '');
      setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (onExpired) onExpired();
      else setError(failure(cause));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function apply() {
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api.saveFolder(input);
      setMessage(result.message);
      // Reload to update needsRestart state
      const updated = await api.settings();
      setData(updated);
      setInput(updated.folderPath || '');
    } catch (cause) {
      if (onExpired) onExpired(); else setError(failure(cause));
    } finally { setSaving(false); }
  }

  async function clear() {
    setClearing(true); setError(''); setMessage('');
    try {
      const result = await api.clearFolder();
      setMessage(result.message);
      setInput('');
      const updated = await api.settings();
      setData(updated);
    } catch (cause) {
      if (onExpired) onExpired(); else setError(failure(cause));
    } finally { setClearing(false); }
  }

  function toggleDarkMode() {
    const next = !darkMode ? 'dark' : 'light';
    setDarkMode(next === 'dark');
    setSavedTheme(next);
  }

  if (loading) return <div className="settings-panel"><p className="placeholder">Cargando configuración…</p></div>;
  if (!data) return <div className="settings-panel error"><p>No se pudo cargar la configuración.</p></div>;

  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <h2 id="settings-title">Apariencia</h2>

      <div className="settings-row theme-row">
        <span className="theme-label-text">Modo oscuro</span>
        <div className="theme-switch">
          <input
            id="dark-mode-toggle"
            type="checkbox"
            role="switch"
            checked={darkMode}
            onChange={toggleDarkMode}
            aria-labelledby="dark-mode-label"
          />
          <span className="theme-switch-track" aria-hidden="true">
            <span className="theme-switch-thumb" />
          </span>
          <span className="theme-switch-label">
            {darkMode ? 'Activado' : 'Desactivado'}
          </span>
        </div>
      </div>

      <h2>Carpeta de almacenamiento</h2>
      
      {data.envOverride && (
        <div className="env-warning" role="alert">
          <p>La variable de entorno CLOUDLOCAL_DATA_DIR controla la carpeta actual. La configuración del navegador no la modificará.</p>
        </div>
      )}

      <div className="settings-row">
        <label htmlFor="storage-folder">Carpeta activa:</label>
        <input id="storage-folder" value={data.activeFolderPath} readOnly />
      </div>

      {data.needsRestart && (
        <div className="restart-banner" role="status">
          <p>Cambio pendiente: la carpeta se aplicará al reiniciar el servidor.</p>
        </div>
      )}

      {!data.envOverride && (
        <>
          <div className="settings-row">
            <label htmlFor="new-folder">Cambiar carpeta:</label>
            <div className="folder-input">
              <input
                id="new-folder"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ruta absoluta de la carpeta"
              />
              <button onClick={apply} disabled={saving}>Guardar</button>
            </div>
          </div>
          <div className="settings-row">
            <button onClick={clear} disabled={clearing || !data.folderPath}>
              {clearing ? 'Restableciendo…' : 'Restablecer carpeta por defecto'}
            </button>
          </div>
        </>
      )}

      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}