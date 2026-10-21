import { useState, type FormEvent } from 'react';
import { api, failure, type Session } from '../api/api';

export function Access({ session, onAccess }: { session: Session; onAccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = !session.configured;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (setup && (password.length < 12 || password.length > 256 || password !== confirm)) {
      setError(password.length < 12 || password.length > 256 ? 'La contraseña debe tener entre 12 y 256 caracteres.' : 'Las contraseñas no coinciden.');
      return;
    }
    setBusy(true); setError('');
    try {
      if (setup) await api.setup(password); // setup itself issues the session cookie
      else await api.login(password);
      setPassword(''); setConfirm(''); onAccess();
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  }
  return <main className="access-shell">
    <div className="access-brand"><span className="brand-mark" aria-hidden="true">C</span><span>CloudLocal</span></div>
    <section className="access-panel" aria-labelledby="access-title">
      <p className="eyebrow">Tu espacio en la red local</p>
      <h1 id="access-title">{setup ? 'Prepara tu nube' : 'Entra a tus archivos'}</h1>
      <p>{setup ? 'Crea una contraseña para proteger los archivos compartidos en casa.' : 'Introduce la contraseña del servidor para continuar.'}</p>
      {setup && !session.localSetup ? <p className="notice" role="status">La configuración inicial solo está disponible desde localhost en el ordenador servidor. Abre allí la aplicación, crea la contraseña y vuelve a esta dirección.</p> :
        <form onSubmit={submit}>
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={setup ? 12 : undefined} maxLength={256} />
          {setup && <><p className="hint">Entre 12 y 256 caracteres.</p><label htmlFor="confirm">Repite la contraseña</label><input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Comprobando…' : setup ? 'Crear y entrar' : 'Entrar'}</button>
        </form>}
    </section>
    <p className="access-foot">Solo red local · HTTP no cifra contraseñas ni archivos. No expongas este servidor a Internet.</p>
  </main>;
}
