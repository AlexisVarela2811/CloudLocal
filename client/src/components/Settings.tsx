import { useState, useEffect } from 'react';
import { api, type SettingsInfo, type Status, failure } from '../api/api';
import { visibleServerUrls } from '../workspace.mjs';

interface SettingsPanelProps {
  onExpired?: () => void;
  status: Status | null;
}

const THEME_KEY = 'cloudlocal-theme';

function getSavedTheme(): 'dark' | 'light' {
  return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'light';
}

function setSavedTheme(theme: 'dark' | 'light') {
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme } }));
}

export function SettingsPanel({ onExpired, status }: SettingsPanelProps) {
  const [data, setData] = useState<SettingsInfo | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => getSavedTheme() === 'dark');
  const [shuttingDown, setShuttingDown] = useState(false);
  const [shutdownMessage, setShutdownMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const networkUrls = visibleServerUrls(status?.urls ?? [], window.location.origin);

  async function copyAddress(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage('Dirección copiada.');
    } catch {
      setCopyMessage('No se pudo copiar automáticamente. Selecciona y copia la dirección.');
    }
  }

  useEffect(() => {
    const sync = () => setDarkMode(getSavedTheme() === 'dark');
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent).detail as { theme?: 'dark' | 'light' } | undefined;
      setDarkMode((detail?.theme ?? getSavedTheme()) === 'dark');
    };
    window.addEventListener('cloudlocal-theme-change', onTheme);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('cloudlocal-theme-change', onTheme);
      window.removeEventListener('storage', sync);
    };
  }, []);


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

  async function shutdownServer() {
    setShuttingDown(true);
    setShutdownMessage('');
    try {
      await api.shutdown();
      setShutdownMessage('Servidor deteniéndose...');
    } catch (cause) {
      setError(failure(cause));
      setShuttingDown(false);
    }
  }

  if (loading) return <div className="settings-panel"><p className="placeholder">Cargando configuración…</p></div>;
  if (!data) return <div className="settings-panel error"><p>No se pudo cargar la configuración.</p></div>;

  return (
    <div className="settings-view">
      <section className="settings-section" aria-labelledby="settings-appearance">
        <div className="settings-section-head">
          <h2 id="settings-appearance">Apariencia</h2>
          <p className="settings-desc">Cómo se ve CloudLocal en este navegador.</p>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Modo oscuro</span>
            <span className="settings-hint">Se guarda en este equipo y sigue al botón de tema de la barra lateral.</span>
          </div>
          <div className="theme-switch">
            <button
              id="dark-mode-toggle"
              type="button"
              role="switch"
              aria-checked={darkMode}
              onClick={toggleDarkMode}
            >
              <span className="toggle-track" />
              <span className="toggle-label-text">
                {darkMode ? 'Activado' : 'Desactivado'}
              </span>
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-storage">
        <div className="settings-section-head">
          <h2 id="settings-storage">Carpeta de almacenamiento</h2>
          <p className="settings-desc">Dónde viven tus archivos en el ordenador servidor.</p>
        </div>

        {data.envOverride && (
          <div className="env-warning" role="alert">
            <p>La variable de entorno CLOUDLOCAL_DATA_DIR controla la carpeta actual. La configuración del navegador no la modificará.</p>
          </div>
        )}

        <div className="settings-row">
          <span className="settings-label">Carpeta activa</span>
          <input id="storage-folder" value={data.activeFolderPath} readOnly className="settings-value" />
        </div>

        {data.needsRestart && (
          <div className="restart-banner" role="status">
            <p>Cambio pendiente: la carpeta se aplicará al reiniciar el servidor.</p>
          </div>
        )}

        {!data.envOverride && (
          <>
            <div className="settings-field">
              <label htmlFor="new-folder">Cambiar carpeta</label>
              <div className="settings-inline">
                <input
                  id="new-folder"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ruta absoluta de la carpeta"
                />
                <button className="btn-primary" onClick={apply} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
            <button className="btn-secondary" onClick={clear} disabled={clearing || !data.folderPath}>
              {clearing ? 'Restableciendo…' : 'Restablecer carpeta por defecto'}
            </button>
          </>
        )}

        {message && <p className="settings-notice" role="status">{message}</p>}
        {error && <p className="settings-error" role="alert">{error}</p>}
      </section>

      <section className="settings-section settings-danger" aria-labelledby="settings-server">
        <div className="settings-section-head">
          <h2 id="settings-server">Servidor</h2>
          <p className="settings-desc">Detener el servidor cierra CloudLocal para todos los equipos hasta que lo vuelvas a abrir.</p>
        </div>
        <div className="settings-field">
          <h3>Conectar otros dispositivos</h3>
          <p className="settings-desc">En otro dispositivo conectado a la misma red, abre una de estas direcciones e inicia sesión.</p>
          {status === null ? <p className="settings-hint">Cargando direcciones…</p> : networkUrls.length === 0 ? (
            <p className="settings-hint">No se detectó ninguna dirección de red. Comprueba la conexión del servidor.</p>
          ) : networkUrls.map((url, index) => (
            <div className="settings-inline" key={url}>
              <input aria-label={networkUrls.length === 1 ? 'Dirección para otros dispositivos' : `Dirección para otros dispositivos ${index + 1}`} value={url} readOnly />
              <button type="button" className="btn-secondary" onClick={() => copyAddress(url)} aria-label={`Copiar ${url}`}>Copiar</button>
            </div>
          ))}
          {copyMessage && <p className="settings-notice" role="status">{copyMessage}</p>}
          <p className="settings-hint">HTTP no cifra contraseñas ni archivos.</p>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Apagar el servidor</span>
            <span className="settings-hint">Los archivos permanecen en el disco del equipo servidor.</span>
          </div>
          <button className="btn-danger" onClick={shutdownServer} disabled={shuttingDown}>
            {shuttingDown ? 'Apagando…' : 'Apagar'}
          </button>
        </div>
        {shutdownMessage && <p className="settings-notice" role="status">{shutdownMessage}</p>}
      </section>
    </div>
  );
}
