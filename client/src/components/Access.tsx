import { useEffect, useState, type FormEvent } from 'react';
import { FaArrowRight, FaInfoCircle, FaMoon, FaSun } from 'react-icons/fa';
import { api, failure, type Session } from '../api/api';

const THEME_KEY = 'cloudlocal-theme';

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (cause) {
    console.warn('No se pudo leer el tema guardado', cause);
    return null;
  }
}

function currentTheme(): 'dark' | 'light' {
  const saved = storedTheme();
  if (saved === 'dark' || saved === 'light') return saved;
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function Access({ session, onAccess }: { session: Session; onAccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(currentTheme);
  const setup = !session.configured;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (cause) {
      console.warn('No se pudo guardar el tema', cause);
    }
    window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme: next } }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (setup && (password.length < 12 || password.length > 256 || password !== confirm)) {
      setError(
        password.length < 12 || password.length > 256
          ? 'La contraseña debe tener entre 12 y 256 caracteres.'
          : 'Las contraseñas no coinciden.'
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (setup) await api.setup(password);
      else await api.login(password);
      setPassword('');
      setConfirm('');
      onAccess();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-shell">
      <header className="access-top">
        <div className="access-brand">
          <img src="/cloudlocal.svg" alt="" className="brand-mark" />
          <span>
            CloudLocal
            <small>servidor privado</small>
          </span>
        </div>
        <div className="access-actions">
          <span className="access-status" title="Servidor local accesible">
            <span className="status-dot" aria-hidden="true" />
            <span className="access-status-text" aria-hidden="true">Servidor local accesible</span>
            <span className="sr-only">Servidor local accesible</span>
          </span>
          <button
            type="button"
            className="access-theme"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? <FaSun aria-hidden="true" /> : <FaMoon aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="access-stage">
        <div className="access-stack">
          <section className="access-panel" aria-labelledby="access-title">
            <p className="eyebrow">Tu espacio en la red local</p>
            <h1 id="access-title">{setup ? 'Prepara tu nube' : 'Entra a tus archivos'}</h1>
            <p>
              {setup
                ? 'Crea una contraseña para proteger los archivos compartidos en casa.'
                : 'Introduce la contraseña del servidor para abrir la carpeta compartida de casa.'}
            </p>

            {setup && !session.localSetup ? (
              <p className="notice" role="status">
                La configuración inicial solo está disponible desde localhost en el ordenador servidor. Abre allí la
                aplicación, crea la contraseña y vuelve a esta dirección.
              </p>
            ) : (
              <form onSubmit={submit} noValidate>
                <label htmlFor="password">Contraseña</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={setup ? 12 : undefined}
                  maxLength={256}
                  placeholder="Contraseña"
                />

                {setup && (
                  <>
                    <p className="hint">Entre 12 y 256 caracteres.</p>
                    <label htmlFor="confirm">Repite la contraseña</label>
                    <input
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                      placeholder="Repite la contraseña"
                    />
                  </>
                )}

                {error && <p className="error" role="alert">{error}</p>}

                <button className="btn-primary" disabled={busy} type="submit">
                  {busy ? 'Comprobando…' : setup ? 'Crear y entrar' : 'Entrar'}
                  {!busy && <FaArrowRight aria-hidden="true" />}
                </button>
              </form>
            )}
          </section>

          {!setup && (
            <div className="access-aside" role="note">
              <FaInfoCircle aria-hidden="true" />
              <span>
                <b>Primera vez aquí:</b> la contraseña se crea desde el propio ordenador servidor, en la pantalla de
                preparación.
              </span>
            </div>
          )}
        </div>
      </div>

      <p className="access-foot">
        Solo red local · HTTP no cifra contraseñas ni archivos. No expongas este servidor a Internet.
      </p>
    </main>
  );
}
