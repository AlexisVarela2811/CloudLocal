import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FaArrowLeft, FaDownload, FaFolder, FaFile } from 'react-icons/fa';
import { api, expired, failure, type Device, type Entry, type Offer } from '../api/api';
import { breadcrumbs, bytes, sortEntries } from '../workspace.mjs';

const offerLabels: Record<Offer['status'], string> = {
  pending: 'Pendiente de aceptación', accepted: 'Aceptado; transfiriendo', delivered: 'Entregado',
  declined: 'Rechazado', failed: 'Fallido'
};
function when(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function SendOffer({ path, onClose, onExpired }: { path: string; onClose: () => void; onExpired: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    api.devices().then(list => { if (active) { setDevices(list); setDeviceId(list[0]?.id || ''); } })
      .catch(cause => { if (active) { if (expired(cause)) onExpired(); else setError(failure(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onExpired]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!deviceId || busy) return;
    setBusy(true);
    setError('');
    try {
      const offer = await api.sendOffer(deviceId, path);
      setResult(`Oferta ${offerLabels[offer.status].toLowerCase()}. El destinatario debe aceptarla y elegir dónde guardarla. No se ha entregado todavía.`);
    }
    catch (cause) {
      if (expired(cause)) onExpired();
      else setError(failure(cause));
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="offer-panel" aria-labelledby="offer-title" onCancel={onClose}>
    <h2 id="offer-title">Enviar a otro equipo</h2>
    <p className="filename">{path}</p>
    <p>Se enviará una oferta, no el archivo todavía. El receptor debe aceptar y escoger dónde guardarlo; no se sobrescriben archivos.</p>
    {loading ? <p role="status">Cargando equipos…</p> : devices.length === 0 ? <p>No hay equipos vinculados. Vincula uno desde «Mis equipos».</p> : !result && <form onSubmit={submit}><label htmlFor="offer-device">Equipo de destino</label><select id="offer-device" value={deviceId} onChange={event => setDeviceId(event.target.value)}>{devices.map(device => <option key={device.id} value={device.id}>{device.name} ({device.online ? 'conectado' : 'desconectado: quedará en cola'})</option>)}</select><button className="primary" disabled={busy}>{busy ? 'Preparando oferta…' : 'Crear oferta'}</button></form>}
    {error && <p className="error" role="alert">{error}</p>}{result && <p className="notice" role="status">{result}</p>}
    <button autoFocus type="button" onClick={onClose}>Cerrar</button>
  </dialog>;
}

export function Devices({ onExpired }: { onExpired: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState<{ deviceId: string; shareId: string; label: string } | null>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderLoading, setFolderLoading] = useState(false);
  const [error, setError] = useState('');
  const [folderError, setFolderError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    Promise.all([api.devices(), api.offers()]).then(([list, transfers]) => {
      if (!active) return;
      setDevices(list); setOffers(transfers);
      setSelected(previous => previous && list.some(d => d.id === previous.deviceId && d.shares.some(s => s.id === previous.shareId)) ? previous : null);
    }).catch(cause => { if (active) { if (expired(cause)) onExpired(); else setError(failure(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, onExpired]);
  const device = devices.find(item => item.id === selected?.deviceId);
  const online = device?.online ?? false;
  useEffect(() => {
    if (!selected || !online) { setEntries([]); setFolderError(''); setFolderLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    setEntries([]); setFolderLoading(true); setFolderError('');
    api.sharedEntries(selected.deviceId, selected.shareId, path, controller.signal).then(list => { if (active) setEntries(list); })
      .catch(cause => { if (active) { if (expired(cause)) onExpired(); else setFolderError(failure(cause)); } })
      .finally(() => { if (active) setFolderLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [selected, online, path, revision, onExpired]);
  async function code() {
    if (busy) return;
    setBusy(true); setError(''); setPair(null);
    try {
      setPair(await api.pairCode());
    } catch (cause) {
      if (expired(cause)) onExpired();
      else setError(failure(cause));
    }
    finally { setBusy(false); }
  }
  async function revoke(item: Device) {
    if (busy || !window.confirm(`¿Desvincular «${item.name}»? Perderá acceso a sus carpetas compartidas y ofertas. No se borrarán sus archivos.`)) return;
    setBusy(true); setError('');
    try { await api.revoke(item.id); if (selected?.deviceId === item.id) { setSelected(null); setPath(''); } setNotice(`«${item.name}» desvinculado. Sus archivos no se han borrado.`); refresh(); }
    catch (cause) { if (expired(cause)) onExpired(); else setError(failure(cause)); }
    finally { setBusy(false); }
  }
  return <div className="devices-view">
    <div className="toolbar"><div><h2>Equipos vinculados</h2><p>Solo las carpetas elegidas en cada equipo se comparten, y solo para lectura.</p></div><button onClick={refresh} disabled={loading}>Actualizar equipos y ofertas</button></div>
    <section className="device-pair"><h3>Vincular otro equipo</h3><p>En el escritorio de ese equipo, abre «Conectar este equipo», elige las carpetas que quieres compartir e introduce este código. El código viaja por HTTP sin cifrar: úsalo solo en una LAN privada.</p><button disabled={busy} onClick={code}>{busy ? 'Generando…' : pair ? 'Generar otro código' : 'Generar código'}</button>
      {pair && (Date.parse(pair.expiresAt) <= now ? <p role="status">El código ha caducado. Genera otro para vincular el equipo.</p> : <p role="status">Código: <strong className="pair-code">{pair.code}</strong> · Caduca: {when(pair.expiresAt)}. No lo compartas fuera de tu red.</p>)}
    </section>
    {error && <div className="notice error" role="alert"><p>{error}</p><button onClick={refresh}>Reintentar</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p role="status">Cargando equipos y ofertas…</p> : devices.length === 0 ? <p className="placeholder">No hay equipos vinculados. Genera un código y conecta el acompañante desde el otro equipo.</p> : <ul className="device-list">{devices.map(item => <li key={item.id} className="device-card"><div className="device-card-head"><div><h3>{item.name}</h3><p>{item.online ? 'Conectado' : 'Desconectado'} · {item.lastSeen ? `Último contacto: ${when(item.lastSeen)}` : 'Sin contacto todavía'}</p></div><button onClick={() => revoke(item)} disabled={busy} aria-label={`Desvincular ${item.name}`}>Desvincular</button></div>
      <p className="hint">Carpetas compartidas · solo lectura</p>{item.shares.length === 0 ? <p>Ninguna carpeta elegida.</p> : <div className="share-list">{item.shares.map(share => <button key={share.id} disabled={!item.online} onClick={() => { setSelected({ deviceId: item.id, shareId: share.id, label: share.label }); setPath(''); }}><FaFolder aria-hidden="true" /> {share.label}</button>)}</div>}{!item.online && <p className="hint">Conecta el acompañante en ese equipo para explorar sus carpetas.</p>}
    </li>)}</ul>}
    {selected && <section className="shared-browser" aria-labelledby="share-title"><button onClick={() => { setSelected(null); setPath(''); }}><FaArrowLeft aria-hidden="true" /> Volver a equipos</button><h3 id="share-title">{device?.name} / {selected.label}</h3><nav className="crumbs" aria-label="Ruta compartida">{breadcrumbs(path).map(crumb => <button key={crumb.path} aria-current={crumb.path === path ? 'page' : undefined} onClick={() => setPath(crumb.path)}>{crumb.name}</button>)}</nav><p className="hint">Solo lectura. El equipo debe estar conectado; no puedes modificar ni eliminar sus archivos desde aquí.</p>
      {!online ? <p role="status">Equipo desconectado. Vuelve a actualizar cuando esté encendido.</p> : folderLoading ? <p role="status">Cargando carpeta compartida…</p> : folderError ? <div role="alert" className="error"><p>{folderError}</p><button onClick={refresh}>Reintentar</button></div> : entries.length === 0 ? <p className="placeholder">Esta carpeta compartida está vacía.</p> : <ul className="entry-list listing">{sortEntries(entries).map(entry => <li className="entry" key={entry.path}><div className="entry-name">{entry.type === 'directory' ? <FaFolder aria-hidden="true" /> : <FaFile aria-hidden="true" />}{entry.type === 'directory' ? <button onClick={() => setPath(entry.path)}>{entry.name}</button> : <span className="filename">{entry.name}</span>}</div><span className="entry-detail">{entry.type === 'file' ? bytes(entry.size) : 'Carpeta'}</span><span className="entry-actions">{entry.type === 'file' && <a href={api.sharedContent(selected.deviceId, selected.shareId, entry.path)} download={entry.name} aria-label={`Descargar ${entry.name}`}><FaDownload aria-hidden="true" /> Descargar</a>}</span></li>)}</ul>}
    </section>}
    <section className="offers-panel"><div className="toolbar"><div><h2>Envíos a equipos</h2><p>Una oferta pendiente no significa que el archivo se haya entregado.</p></div><button onClick={refresh} disabled={loading}>Actualizar estados</button></div>{offers.length === 0 ? <p>No hay ofertas de envío.</p> : <ul>{offers.map(offer => <li key={offer.id}><strong>{offer.name}</strong> · {devices.find(item => item.id === offer.deviceId)?.name || 'Equipo desvinculado'} · {bytes(offer.size)} · {offerLabels[offer.status]} · Caduca: {when(offer.expiresAt)}</li>)}</ul>}<p className="hint">El receptor debe aceptar cada oferta y elegir dónde guardarla en su escritorio. No se sobrescriben archivos.</p></section>
  </div>;
}
