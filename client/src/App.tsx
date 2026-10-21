import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  FaFolder, FaFile, FaDownload, FaTrash, FaUndo,
  FaArrowLeft, FaPlus, FaUpload, FaSync, FaServer,
  FaSignOutAlt, FaCopy, FaWifi, FaQuestionCircle,
  FaSpinner, FaExclamationTriangle, FaFolderOpen,
  FaFilePdf, FaEye, FaArrowsAlt,
  FaImage, FaVideo, FaMusic
} from 'react-icons/fa';
import { api, expired, failure, type Entry, type Session, type Status, type TrashEntry } from './api/api';

const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.ps1', '.reg']);

function isExtensionBlocked(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && BLOCKED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function isExtensionBlockedList(filenames: string[]): string[] {
  return filenames.filter(isExtensionBlocked);
}
import { Access } from './components/Access';
import { Preview } from './components/Preview';
import { DragAndDrop } from './components/DragAndDrop';
import { SettingsPanel } from './components/Settings';
import { breadcrumbs, bytes, exceedsLimit, previewKind, sortEntries, visibleServerUrls } from './workspace.mjs';

type View = 'files' | 'trash' | 'settings';

type ClipboardAction = 'copy' | 'move';

interface ClipboardState {
  type: ClipboardAction;
  paths: string[];
}

interface UploadItem {
  id: number;
  name: string;
  state: string;
  progress: number;
  error?: string;
}

function date(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '—' : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [entryError, setEntryError] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<View>('files');
  const [fileView, setFileView] = useState<'list' | 'grid'>('list');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; currentName: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [preview, setPreview] = useState<Entry | null>(null);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [revision, setRevision] = useState(0);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const loseSession = useCallback(() => {
    setSession(previous => previous ? { ...previous, authenticated: false } : previous);
    setNotice('La sesión ha caducado. Entra otra vez para continuar.');
  }, []);

  // Upload items (shared between file picker and drag-drop)
  const [uploadBusy, setUploadBusy] = useState(false);
  const cancelUploadRef = useRef(false);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const uploadNextId = useRef(0);
  const pendingUploadsRef = useRef<{ file: File; id: number; folder: string }[]>([]);
  const isUploadingRef = useRef(false);
  const MAX_RECONNECT = 3;

  function updateUploadItem(_id: number, _patch: Partial<UploadItem>) {
    // Upload item state tracking placeholder — kept for API compatibility
  }

  function enqueueFiles(files: File[], _folderPath: string) {
    const blockedNames = isExtensionBlockedList(files.map(f => f.name));
    if (blockedNames.length > 0) {
      setError(`No se permiten los siguientes tipos de archivo: ${blockedNames.join(', ')}`);
      return;
    }
    const batch = files.map(file => ({ file, id: ++uploadNextId.current, folder }));
    pendingUploadsRef.current.push(...batch);
    startNextUpload();
  }

  async function startNextUpload() {
    if (isUploadingRef.current || pendingUploadsRef.current.length === 0) return;
    isUploadingRef.current = true;
    setUploadBusy(true);
    try {
      while (pendingUploadsRef.current.length > 0 && !cancelUploadRef.current) {
        const item = pendingUploadsRef.current.shift();
        if (!item) break;
        if (exceedsLimit(item.file.size, status?.maxUploadBytes)) {
          updateUploadItem(item.id, { state: `Supera el límite de ${bytes(status?.maxUploadBytes ?? 0)}` });
          continue;
        }
        updateUploadItem(item.id, { state: 'Subiendo', progress: 0 });
        const active = new AbortController();
        uploadControllerRef.current = active;
        let attempt = 0;
        let uploaded = false;
        while (!uploaded && attempt < MAX_RECONNECT) {
          if (cancelUploadRef.current) { updateUploadItem(item.id, { state: 'Cancelado' }); break; }
          try {
            updateUploadItem(item.id, { state: 'Subiendo' });
            await api.upload(item.folder, item.file, active.signal, percent =>
              updateUploadItem(item.id, { progress: percent })
            );
            updateUploadItem(item.id, { state: 'Subido', progress: 100 });
            refresh();
            uploaded = true;
          } catch (cause: unknown) {
            if (expired(cause)) {
              updateUploadItem(item.id, { state: 'Sesión caducada; vuelve a entrar' });
              cancelUploadRef.current = true;
              onExpired();
              uploaded = true;
            } else if (active.signal.aborted) {
              updateUploadItem(item.id, { state: 'Cancelado' });
              uploaded = true;
            } else if (attempt < MAX_RECONNECT - 1) {
              attempt++;
              updateUploadItem(item.id, { state: `Reconectando… (${attempt}/${MAX_RECONNECT - 1})` });
              await new Promise(r => setTimeout(r, 2000 * attempt));
            } else {
              updateUploadItem(item.id, { state: failure(cause), error: failure(cause) });
              uploaded = true;
            }
          }
        }
      }
    } finally {
      isUploadingRef.current = false;
      setUploadBusy(false);
    }
  }

  async function selectFilePickerFiles(files: File[]) {
    if (isUploadingRef.current) return;
    cancelUploadRef.current = false;
    const blockedNames = isExtensionBlockedList(files.map(f => f.name));
    if (blockedNames.length > 0) {
      setError(`No se permiten los siguientes tipos de archivo: ${blockedNames.join(', ')}`);
      return;
    }
    const batch = files.map(file => ({ file, id: ++uploadNextId.current, folder }));
    pendingUploadsRef.current.push(...batch);
    startNextUpload();
  }

  // Sort entries for keyboard shortcuts
  const sorted = sortEntries(entries);

  useEffect(() => { let active = true; api.session().then(value => { if (active) setSession(value); }).catch(cause => { if (active) setEntryError(failure(cause)); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    setLoading(true); setError('');
    const load = view === 'files' ? api.files(folder, query) : api.trash();
    load.then(result => { if (!active) return; if (view === 'files') setEntries(result as Entry[]); else setTrash(result as TrashEntry[]); })
      .catch(cause => { if (!active) return; if (expired(cause)) loseSession(); else setError(failure(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.authenticated, folder, query, view, revision, loseSession]);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    api.status().then(value => { if (active) setStatus(value); }).catch(cause => { if (active) { if (expired(cause)) loseSession(); else setNotice(`No se pudo consultar el espacio: ${failure(cause)}`); } });
    return () => { active = false; };
  }, [session?.authenticated, revision, loseSession]);

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isCtrl = event.ctrlKey || event.metaKey;
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName);

      if (isCtrl && event.key === 'a' && !isInputFocused) {
        event.preventDefault();
        setSelected(sorted.map(en => en.path));
        setNotice(`${sorted.length} elemento${sorted.length !== 1 ? 's' : ''} seleccionado.`);
      } else if (isCtrl && event.key === 'c' && selected.length > 0 && !isInputFocused) {
        event.preventDefault();
        setClipboard({ type: 'copy', paths: [...selected] });
        setNotice(`Copiado ${selected.length} elemento${selected.length !== 1 ? 's' : ''}.`);
      } else if (isCtrl && event.key === 'x' && selected.length > 0 && !isInputFocused) {
        event.preventDefault();
        setClipboard({ type: 'move', paths: [...selected] });
        setNotice(`Cortado ${selected.length} elemento${selected.length !== 1 ? 's' : ''}.`);
      } else if (isCtrl && event.key === 'v' && clipboard && !isInputFocused) {
        event.preventDefault();
        handlePaste(folder);
      } else if (event.key === 'Delete' && selected.length > 0 && !isInputFocused) {
        event.preventDefault();
        if (selected.length === 1) {
          action(() => api.trashFile(selected[0]), `«${selected[0].split('/').at(-1)}» está en la papelera.`).then(() => setSelected([]));
        } else {
          const names = selected.map(p => p.split('/').at(-1)).filter(Boolean);
          Promise.all(selected.map(p => api.trashFile(p).catch(() => null))).then(() => {
            setSelected([]);
            setNotice(`${names.length} archivo${names.length !== 1 ? 's' : ''} enviado${names.length !== 1 ? 's' : ''} a la papelera.`);
          });
        }
      } else if (event.key === 'Escape') {
        if (renaming) {
          setRenaming(null);
          setRenameInput('');
        } else if (preview) {
          setPreview(null);
        } else {
          setSelected([]);
        }
      } else if (event.key === 'F2' && selected.length > 0 && !isInputFocused) {
        event.preventDefault();
        const first = sorted.find(en => en.path === selected[0]);
        if (first) startRename(first.path, first.name);
      } else if (isCtrl && event.key === 's' && !isInputFocused) {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, sorted, clipboard, preview, renaming, folder, action]);

  // ── Click outside to cancel rename ───────────────────────
  useEffect(() => {
    if (!renaming) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.rename-input')) {
        setRenaming(null);
        setRenameInput('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [renaming]);

  function onExpired() { loseSession(); }

  // ── Rename helpers ───────────────────────────────────────
  function startRename(path: string, currentName: string) {
    const dotIndex = currentName.lastIndexOf('.');
    const isFile = dotIndex > 0 && !currentName.endsWith('.');
    setRenaming({ path, currentName });
    setRenameInput(isFile ? currentName.slice(0, dotIndex) : currentName);
  }

  function submitRename() {
    if (!renaming) return;
    const newName = renameInput.trim();
    if (!newName) return;
    const invalidChars = /[\/:*?"<>|\\]/;
    if (invalidChars.test(newName)) {
      setError('El nombre no puede contener: / \ : * ? " < > |');
      return;
    }
    const fromPath = renaming.path;
    const parent = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
    const toPath = parent + newName;
    action(() => api.moveFile(fromPath, toPath), `«${renaming.currentName}» renombrado a «${newName}».`);
    setRenaming(null);
    setRenameInput('');
  }

  function handlePaste(targetFolder: string) {
    if (!clipboard) return;
    const { type, paths } = clipboard;
    const names = paths.map(p => p.split('/').at(-1)).filter(Boolean);
    if (type === 'copy') {
      Promise.all(paths.map(from => api.copy(from, targetFolder))).then(() => {
        setNotice(`${names.length} archivo${names.length !== 1 ? 's' : ''} copiado${names.length !== 1 ? 's' : ''} a ${targetFolder || 'inicio'}.`);
        setClipboard(null);
        refresh();
      }).catch(cause => {
        if (expired(cause)) loseSession();
        else setError(failure(cause));
      });
    } else {
      Promise.all(paths.map(from => api.moveFile(from, targetFolder))).then(() => {
        setNotice(`${names.length} archivo${names.length !== 1 ? 's' : ''} movido${names.length !== 1 ? 's' : ''} a ${targetFolder || 'inicio'}.`);
        setClipboard(null);
        refresh();
      }).catch(cause => {
        if (expired(cause)) loseSession();
        else setError(failure(cause));
      });
    }
  }
  function go(path: string) { setFolder(path); setQuery(''); setSelected([]); setPreview(null); setError(''); }
  async function action(task: () => Promise<unknown>, success: string) {
    setSaving(true); setError(''); setNotice('');
    try { await task(); setNotice(success); refresh(); }
    catch (cause) { if (expired(cause)) loseSession(); else setError(failure(cause)); }
    finally { setSaving(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (saving || !folderName.trim()) return;
    const name = folderName.trim();
    setSaving(true); setError('');
    try { await api.folder(folder, name); setFolderName(''); setCreating(false); setNotice(`Carpeta «${name}» creada.`); refresh(); }
    catch (cause) { if (expired(cause)) loseSession(); else setError(failure(cause)); }
    finally { setSaving(false); }
  }
  function download(paths: string[]) {
    for (const path of paths) {
      const link = document.createElement('a'); link.href = api.content(path); link.download = path.split('/').at(-1) || 'archivo';
      document.body.append(link); link.click(); link.remove();
    }
    setNotice(`${paths.length} descarga${paths.length === 1 ? '' : 's'} individual${paths.length === 1 ? '' : 'es'} solicitada${paths.length === 1 ? '' : 's'} al navegador. Comprueba sus descargas.`);
  }
  async function movePath(from: string, targetFolder: string) {
    if (from === targetFolder) return;
    const name = from.split('/').at(-1) || '';
    try {
      await api.moveFile(from, targetFolder);
      setNotice(`"${name}" movido a ${targetFolder || 'inicio'}.`);
      refresh();
    } catch (cause: unknown) {
      if (expired(cause)) loseSession();
      else setError(failure(cause));
    }
  }
  async function copyUrl(url: string) {
    setCopyError('');
    try { await navigator.clipboard.writeText(url); setNotice('Dirección copiada.'); }
    catch { setCopyError('No se pudo copiar automáticamente. Selecciona y copia la dirección del enlace.'); }
  }

  // ── Auth gate ──────────────────────────────────────────────
  if (!session) return <main className="auth-gate" role="status">{entryError ? <><p className="error-text">{entryError}</p><button className="btn-retry" onClick={() => { setEntryError(''); api.session().then(setSession).catch(cause => setEntryError(failure(cause))); }}>Reintentar conexión</button></> : <p>Conectando con CloudLocal…</p>}</main>;
  if (!session.authenticated) return <><Access session={session} onAccess={() => { setSession({ ...session, configured: true, authenticated: true }); refresh(); }} />{notice && <p className="session-notice" role="status">{notice}</p>}</>;

  const crumbs = breadcrumbs(folder);
  const serverUrls = visibleServerUrls(status?.urls, window.location.origin);

  // ── Main shell ─────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`} aria-label="Navegación principal">
        {/* Mobile toggle */}
        <button className="sidebar-toggle" aria-label="Abrir menú" onClick={() => setSidebarOpen(true)}>
          <FaWifi aria-hidden="true" />
        </button>

        {/* Logo */}
        <div className="sidebar-logo">
          <span className="logo-icon" aria-hidden="true">C</span>
          <span className="logo-text">CloudLocal</span>
        </div>

        {/* Caption */}
        <p className="sidebar-caption">ESPACIO LOCAL</p>

        {/* Navigation */}
        <nav className="sidebar-nav" aria-label="Secciones">
          <button className={`nav-item${view === 'files' ? ' active' : ''}`} onClick={() => { setView('files'); setSidebarOpen(false); }}>
            <FaFolder aria-hidden="true" />
            <span>Archivos</span>
          </button>
          <button className={`nav-item${view === 'trash' ? ' active' : ''}`} onClick={() => { setView('trash'); setSelected([]); setPreview(null); setSidebarOpen(false); }}>
            <FaTrash aria-hidden="true" />
            <span>Papelera</span>
          </button>
          <button className={`nav-item${view === 'settings' ? ' active' : ''}`} onClick={() => { setView('settings'); setSelected([]); setPreview(null); setSidebarOpen(false); }}>
            <FaQuestionCircle aria-hidden="true" />
            <span>Configuración</span>
          </button>
        </nav>

        {/* Device connection link */}
        <button className="device-link" onClick={() => {
          setView('files');
          setSidebarOpen(false);
          requestAnimationFrame(() => document.getElementById('connect-devices-card')?.scrollIntoView({ behavior: 'smooth' }));
        }}>
          <FaServer aria-hidden="true" />
          <span>Conectar otro dispositivo</span>
        </button>

        {/* Status */}
        <div className="sidebar-status">
          <span className="status-dot" aria-hidden="true" />
          <span>El servidor debe permanecer encendido y despierto.</span>
        </div>

        {/* Footer – logout */}
        <div className="sidebar-footer">
          <button
            className="btn-logout"
            disabled={saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await api.logout();
                setSession({ ...session, authenticated: false });
                setSelected([]);
                setPreview(null);
                setNotice('Sesión cerrada.');
              } catch (cause: unknown) {
                if (expired(cause)) loseSession();
                else setError(failure(cause));
              } finally { setSaving(false); }
            }}
          >
            <FaSignOutAlt aria-hidden="true" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main Area ───────────────────────────────────────── */}
      <main className="main-area">

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            {/* Mobile close button */}
            <button className="sidebar-close" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)}>
              <FaWifi aria-hidden="true" />
            </button>
            {/* Breadcrumb */}
            {folder !== '' && view === 'files' && (
              <button className="btn-back" onClick={() => go(folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '')}>
                <FaArrowLeft aria-hidden="true" /> Volver
              </button>
            )}
            <nav className="breadcrumb" aria-label="Ruta">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path}>
                  {index > 0 && <span className="breadcrumb-sep">/</span>}
                  <button
                    aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                    onClick={() => go(crumb.path)}
                    title={crumb.path || 'Inicio'}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
            {/* Title */}
            <div>
              <h1 className="page-title">
                {view === 'trash' ? 'Papelera' : view === 'settings' ? 'Configuración' : 'Mis archivos'}
              </h1>
              {view === 'files' && <p className="page-subtitle">Gestiona tus archivos en tu red local. Crea carpetas, sube archivos y comparte con otros dispositivos.</p>}
              {view === 'trash' && <p className="page-subtitle">Restaura o elimina permanentemente los archivos borrados.</p>}
            </div>
          </div>
          <div className="topbar-actions">
            {clipboard && (
              <button className="btn-icon" onClick={() => handlePaste(folder)} title="Pegar en esta carpeta">
                <FaCopy aria-hidden="true" />
                <span className="btn-label">Pegar</span>
              </button>
            )}
            {view === 'files' && (
              <div className="view-toggle" role="radiogroup" aria-label="Vista de archivos">
                <button
                  className={`view-btn ${fileView === 'list' ? 'active' : ''}`}
                  onClick={() => setFileView('list')}
                  role="radio"
                  aria-checked={fileView === 'list'}
                  aria-label="Vista de lista"
                  title="Vista de lista"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="12" height="2" rx="0.5" fill="currentColor"/>
                    <rect x="2" y="7" width="12" height="2" rx="0.5" fill="currentColor"/>
                    <rect x="2" y="12" width="12" height="2" rx="0.5" fill="currentColor"/>
                  </svg>
                </button>
                <button
                  className={`view-btn ${fileView === 'grid' ? 'active' : ''}`}
                  onClick={() => setFileView('grid')}
                  role="radio"
                  aria-checked={fileView === 'grid'}
                  aria-label="Vista de cuadrícula"
                  title="Vista de cuadrícula"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                  </svg>
                </button>
              </div>
            )}
            <button className="btn-icon" onClick={() => setCreating(value => !value)} title="Nueva carpeta">
              <FaPlus aria-hidden="true" />
              <span className="btn-label">Nueva carpeta</span>
              <span className="shortcut-hint">Ctrl+N</span>
            </button>
            <label className={`btn-upload button-like${uploadBusy ? ' busy' : ''}`} title="Elegir archivos para subir">
              <FaUpload aria-hidden="true" />
              <span className="btn-label">Elegir archivos</span>
              <input
                type="file" multiple
                onChange={e => { if (e.target.files?.length) selectFilePickerFiles(Array.from(e.target.files)); e.target.value = ''; }}
                disabled={uploadBusy}
                aria-label="Elegir archivos para subir"
              />
            </label>
            <button className="btn-ghost" onClick={async () => {
              if (saving) return; setSaving(true);
              try { await api.logout(); setSession({ ...session, authenticated: false }); setSelected([]); setPreview(null); setNotice('Sesión cerrada.'); }
              catch (cause: unknown) { if (expired(cause)) loseSession(); else setError(failure(cause)); }
              finally { setSaving(false); }}
            }>
              <FaSignOutAlt aria-hidden="true" />
              <span className="btn-label">Cerrar sesión</span>
            </button>
          </div>
        </header>

        {/* Workspace body */}
        <div className="workspace-body">
          {view === 'files' ? (
            <>
              {/* ── Connect Device Card ─────────────────────── */}
              <section id="connect-devices-card" className="card card-accent" aria-labelledby="conn-title">
                <div className="card-header-icon">
                  <FaServer aria-hidden="true" />
                </div>
                <div className="card-content">
                  <h2 id="conn-title">Conectar otro dispositivo</h2>
                  <p>En el otro ordenador o móvil, abre una de estas direcciones en el navegador y entra con la contraseña de CloudLocal. No necesitas instalar ni vincular otro equipo.</p>
                  {serverUrls.length ? (
                    <div className="url-list">
                      {serverUrls.map(url => (
                        <div key={url} className="url-row">
                          <code className="url-text">{url}</code>
                          <button className="btn-copy" onClick={() => copyUrl(url)} title="Copiar URL">
                            <FaCopy aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="no-url">No hay una dirección LAN disponible. Consulta la dirección IP y el puerto reales en el ordenador servidor.</p>
                  )}
                  {copyError && <p className="error-text">{copyError}</p>}
                  <div className="disk-info-row">
                    <span className="disk-space">
                      Espacio del disco:{' '}
                      {status ? `${bytes(status.storage.free)} libres de ${bytes(status.storage.total)}` : 'No disponible'}
                    </span>
                    <span className="disk-badge">HTTP · Solo red local</span>
                  </div>
                </div>
              </section>

              {/* ── Toolbar ─────────────────────────────────── */}
              <div className="toolbar">
                <div className="search-row">
                  <div className="search-wrapper">
                    <input
                      className="search-input"
                      type="search"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Buscar en esta carpeta…"
                      aria-label="Buscar archivos"
                    />
                    {query && <button className="btn-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">✕</button>}
                  </div>
                  <button className="btn-icon btn-refresh" onClick={refresh} disabled={loading} title="Actualizar">
                    <FaSync aria-hidden="true" />
                    <span className="btn-label">Actualizar</span>
                  </button>
                </div>
              </div>

              {/* ── New folder form ───────────────────────── */}
              {creating && (
                <form className="card folder-form" onSubmit={create}>
                  <h3>Nueva carpeta</h3>
                  <div className="form-row">
                    <input
                      id="folder-name"
                      autoFocus
                      value={folderName}
                      onChange={e => setFolderName(e.target.value)}
                      required maxLength={255}
                      placeholder="Nombre de la carpeta"
                    />
                    <button className="btn-primary" type="submit" disabled={saving || !folderName.trim()}>
                      {saving ? 'Creando…' : 'Crear carpeta'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {/* ── Selection bar ─────────────────────────── */}
              {selected.length > 0 && (
                <div className="selection-bar" role="status">
                  <span>{selected.length} seleccionado{selected.length !== 1 ? 's' : ''}</span>
                  {clipboard && (
                    <button onClick={() => handlePaste(folder)}>
                      <FaCopy aria-hidden="true" /> Pegar aquí
                    </button>
                  )}
                  <button onClick={() => download(selected)}>
                    <FaDownload aria-hidden="true" /> Descargar
                  </button>
                  <button onClick={async () => {
                    if (selected.length === 1) { await movePath(selected[0], ''); }
                    else { setNotice('Selecciona un solo archivo para mover. Arrastra archivos o carpetas sobre otra carpeta para moverlos dentro de ella.'); }
                  }}>
                    <FaFolder aria-hidden="true" /> Mover
                  </button>
                  <button className="btn-danger" onClick={() => setSelected([])}>
                    Limpiar selección
                  </button>
                </div>
              )}

              {/* ── Upload card ───────────────────────────── */}
              <section className="card card-upload" aria-label="Subir archivos">
                <div className="card-content">
                  <h3>Subir archivos</h3>
                  <p>{status ? `Sube archivos aquí. Tamaño máximo por archivo: ${bytes(status.maxUploadBytes)}.` : 'Sube tus archivos aquí.'}</p>
                  <div className="upload-warning">
                      <FaExclamationTriangle size={13} />
                      <span>Algunos tipos de archivo no están permitidos</span>
                    </div>
                  <div className="upload-actions-row">
                    <label className={`btn-accent button-like${uploadBusy ? ' busy' : ''}`}>
                    <FaUpload aria-hidden="true" />
                    <span>Elegir archivos</span>
                    <input
                      type="file" multiple
                      onChange={e => { if (e.target.files?.length) selectFilePickerFiles(Array.from(e.target.files)); e.target.value = ''; }}
                      disabled={uploadBusy}
                      aria-label="Elegir archivos para subir"
                    />
                    </label>
                  </div>
                </div>
              </section>

              {/* ── Drag & Drop overlay ───────────────────── */}
              <DragAndDrop onFilesDropped={enqueueFiles} folderPath={folder || 'inicio'} />

              {fileView === 'list' ? (
                <>
                  {/* ── File list – list view ─────────────────── */}
                  <section className="card file-table" aria-label="Contenido de la carpeta"
                    onDragEnter={e => { if (e.dataTransfer?.types?.includes('Files')) e.currentTarget.classList.add('drag-active'); }}
                    onDragLeave={e => { const rel = e.relatedTarget as HTMLElement | null; if (rel instanceof HTMLElement && e.currentTarget.contains(rel)) return; e.currentTarget.classList.remove('drag-active'); }}
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('drag-active');
                      if (e.dataTransfer?.getData('application/x-cloudlocal-move')) return;
                      const dt = e.dataTransfer;
                      if (!dt?.files?.length) return;
                      const files: File[] = [];
                      for (let i = 0; i < dt.items?.length; i++) {
                        const ent = dt.items[i].webkitGetAsEntry?.();
                        if (ent?.isFile) { (ent as FileSystemFileEntry).file(f => files.push(f)); }
                      }
                      for (let j = 0; j < dt.files.length; j++) files.push(dt.files[j]);
                      setTimeout(() => { if (files.length > 0) enqueueFiles(files, folder || 'inicio'); }, 50);
                    }}
                  >
                    {/* Table header */}
                    <div className="table-head">
                      <div className="col-check">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todo"
                          checked={sorted.length > 0 && sorted.every(e => selected.includes(e.path))}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelected(sorted.map(en => en.path));
                            } else {
                              setSelected([]);
                            }
                          }}
                        />
                      </div>
                      <div className="col-name">NOMBRE</div>
                      <div className="col-details">DETALLES</div>
                      <div className="col-actions">ACCIONES</div>
                    </div>

                    {/* Loading */}
                    {loading && <div className="table-row loading-row"><div className="col-check" /><div className="col-name"><span className="placeholder">Cargando archivos…</span></div><div className="col-details" /><div className="col-actions" /></div>}

                    {/* Error */}
                    {error && !loading && (
                      <div className="table-row error-row">
                        <div className="col-check" />
                        <div className="col-name">
                          <div className="table-error">
                            <p>{error}</p>
                            <button onClick={refresh}>Reintentar</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Empty */}
                    {!loading && !error && sorted.length === 0 && (
                      <div className="table-row table-row-full">
                        <div className="table-cell-full">
                          <span className="placeholder">{query ? 'No hay coincidencias en esta carpeta.' : 'Esta carpeta está vacía. Puedes crear una carpeta o subir archivos.'}</span>
                        </div>
                      </div>
                    )}

                    {/* File rows */}
                    {!loading && !error && sorted.map(entry => (
                      <div
                        key={entry.path}
                        className={`table-row entry${dragOver === entry.path ? ' drag-target' : ''}`}
                        draggable={entry.type === 'file' || entry.type === 'directory'}
                        onDragStart={e => {
                          e.stopPropagation();
                          const dt = e.dataTransfer;
                          dt.setData('application/x-cloudlocal-move', entry.path);
                          dt.effectAllowed = 'move';
                        }}
                      >
                        {/* Checkbox / icon */}
                        <div className="col-check">
                          {entry.type === 'file' ? (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${entry.name}`}
                              checked={selected.includes(entry.path)}
                              onChange={e => setSelected(old => e.target.checked ? [...old, entry.path] : old.filter(path => path !== entry.path))}
                            />
                          ) : <span className="checkbox-space" />}
                        </div>

                        {/* Name */}
                        <div className="col-name"
                          onDragEnter={e => { if (entry.type !== 'directory') return; e.stopPropagation(); setDragOver(entry.path); }}
                          onDragLeave={() => { if (entry.type !== 'directory') return; setDragOver(null); }}
                          onDragOver={e => { if (entry.type !== 'directory') return; e.preventDefault(); const dt = e.dataTransfer; dt.dropEffect = 'move'; }}
                          onDrop={e => {
                            if (entry.type !== 'directory') return;
                            e.preventDefault(); e.stopPropagation(); setDragOver(null);
                            const movedPath = e.dataTransfer?.getData('application/x-cloudlocal-move');
                            if (movedPath) { movePath(movedPath, entry.path); }
                          }}
                        >
                          <span className="file-icon">{entry.type === 'directory' ? <FaFolder aria-hidden="true" /> : <FaFile aria-hidden="true" />}</span>
                          {renaming?.path === entry.path ? (
                            <input
                              className="rename-input"
                              value={renameInput}
                              onChange={e => setRenameInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setRenaming(null); setRenameInput(''); } }}
                              onBlur={submitRename}
                              autoFocus
                              title={entry.name}
                            />
                          ) : entry.type === 'directory' ? (
                            <button onClick={() => go(entry.path)} onDoubleClick={() => startRename(entry.path, entry.name)} className="file-name" title={entry.name}>{entry.name}</button>
                          ) : (
                            <span onDoubleClick={() => startRename(entry.path, entry.name)} className="file-name" title={entry.name}>{entry.name}</span>
                          )}
                        </div>

                        {/* Details */}
                        <div className="col-details">
                          {entry.type === 'file' ? `${bytes(entry.size)} · ${date(entry.modifiedAt)}` : `Carpeta · ${date(entry.modifiedAt)}`}
                        </div>

                        {/* Actions */}
                        <div className="col-actions">
                          {entry.type === 'file' ? (
                            <span className="action-group">
                              {previewKind(entry.name) && (
                                <button
                                  className="btn-action"
                                  onClick={() => previewKind(entry.name) === 'pdf'
                                    ? window.open(api.content(entry.path, true), '_blank', 'noopener,noreferrer')
                                    : setPreview(entry)
                                  }
                                  title="Vista previa"
                                >
                                  Vista previa
                                </button>
                              )}
                              <a
                                href={api.content(entry.path)}
                                download={entry.name}
                                className="btn-action"
                                title={`Descargar ${entry.name}`}
                              >
                                <FaDownload aria-hidden="true" />
                              </a>
                              <button
                                className="btn-action btn-delete"
                                disabled={saving}
                                onClick={() => {
                                  if (window.confirm(`¿Enviar «${entry.name}» a la papelera? Puedes restaurarlo después.`)) {
                                    action(() => api.trashFile(entry.path), `«${entry.name}» está en la papelera.`).then(() => setSelected(old => old.filter(path => path !== entry.path)));
                                  }
                                }}
                                title={`Enviar ${entry.name} a papelera`}
                              >
                                <FaTrash aria-hidden="true" />
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </section>
                </>
              ) : (
                /* ── File list – grid view ───────────────────── */
                <section className="card file-grid" aria-label="Contenido de la carpeta"
                  onDragEnter={e => { if (e.dataTransfer?.types?.includes('Files')) e.currentTarget.classList.add('drag-active'); }}
                  onDragLeave={e => { const rel = e.relatedTarget as HTMLElement | null; if (rel instanceof HTMLElement && e.currentTarget.contains(rel)) return; e.currentTarget.classList.remove('drag-active'); }}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag-active');
                    if (e.dataTransfer?.getData('application/x-cloudlocal-move')) return;
                    const dt = e.dataTransfer;
                    if (!dt?.files?.length) return;
                    const files: File[] = [];
                    for (let i = 0; i < dt.items?.length; i++) {
                      const ent = dt.items[i].webkitGetAsEntry?.();
                      if (ent?.isFile) { (ent as FileSystemFileEntry).file(f => files.push(f)); }
                    }
                    for (let j = 0; j < dt.files.length; j++) files.push(dt.files[j]);
                    setTimeout(() => { if (files.length > 0) enqueueFiles(files, folder || 'inicio'); }, 50);
                  }}
                >
                  <div className="grid-container">
                    {loading && (
                      <div className="grid-item grid-loading">
                        <div className="grid-icon"><FaSpinner className="fa-spin" size={24} /></div>
                        <span className="placeholder">Cargando…</span>
                      </div>
                    )}
                    {error && (
                      <div className="grid-item grid-error">
                        <div className="grid-icon"><FaExclamationTriangle size={24} /></div>
                        <span className="error-text">{error}</span>
                        <button onClick={refresh} className="btn-action">Reintentar</button>
                      </div>
                    )}
                    {sorted.map(entry => (
                      <div
                        key={entry.path}
                        className={`grid-item entry${selected.includes(entry.path) ? ' selected' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSelected(old => selected.includes(entry.path) ? old.filter(p => p !== entry.path) : [...old, entry.path]); }}
                        onDoubleClick={() => entry.type === 'directory' ? go(entry.path) : startRename(entry.path, entry.name)}
                        draggable={true}
                        onDragStart={(e) => { e.dataTransfer.setData('application/x-cloudlocal-move', entry.path); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { if (entry.type === 'directory') { e.preventDefault(); e.stopPropagation(); setDragOver(entry.path); } }}
                        onDragLeave={() => { if (entry.type === 'directory') setDragOver(null); }}
                        onDrop={(e) => {
                          if (entry.type !== 'directory') return;
                          e.preventDefault(); e.stopPropagation(); setDragOver(null);
                          const movedPath = e.dataTransfer?.getData('application/x-cloudlocal-move');
                          if (movedPath) { movePath(movedPath, entry.path); }
                        }}
                        tabIndex={0}
                        role="listitem"
                        aria-label={`${entry.name}${entry.type === 'directory' ? ' carpeta' : ' archivo'}`}
                        aria-selected={selected.includes(entry.path)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(old => selected.includes(entry.path) ? old.filter(p => p !== entry.path) : [...old, entry.path]); } }}
                      >
                        <div className="grid-icon" data-icon-type={entry.type === 'directory' ? 'folder' : previewKind(entry.name)} onClick={(e) => { e.stopPropagation(); entry.type === 'directory' ? go(entry.path) : startRename(entry.path, entry.name); }}>
                          {entry.type === 'directory' ? (
                            <FaFolder size={32} color="var(--accent)" />
                          ) : previewKind(entry.name) === 'pdf' ? (
                            <FaFilePdf size={32} color="#dc2626" />
                          ) : previewKind(entry.name) === 'image' ? (
                            <FaImage size={32} color="#059669" />
                          ) : previewKind(entry.name) === 'video' ? (
                            <FaVideo size={32} color="#7c3aed" />
                          ) : previewKind(entry.name) === 'audio' ? (
                            <FaMusic size={32} color="#0891b2" />
                          ) : (
                            <FaFile size={32} color="var(--muted)" />
                          )}
                        </div>
                        <div className="grid-check">
                          <input
                            type="checkbox"
                            checked={selected.includes(entry.path)}
                            onChange={() => setSelected(old => selected.includes(entry.path) ? old.filter(p => p !== entry.path) : [...old, entry.path])}
                            aria-label={`Seleccionar ${entry.name}`}
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                        <span className="grid-name" title={entry.path}>
                          {renaming?.path === entry.path ? (
                            <input
                              autoFocus
                              value={renameInput}
                              onChange={e => setRenameInput(e.target.value)}
                              onBlur={() => submitRename()}
                              onKeyDown={e => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') { setRenaming(null); setRenameInput(''); }
                              }}
                              onClick={e => e.stopPropagation()}
                              className="rename-input"
                              style={{ width: '100%', textAlign: 'center' }}
                            />
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); startRename(entry.path, entry.name); }} title={entry.name}>{entry.name}</button>
                          )}
                          {entry.type === 'directory' && <small>{bytes(entry.size)}</small>}
                        </span>
                        <div className="grid-actions">
                          {entry.type === 'file' && (
                            <>
                              <button className="btn-action" title="Descargar" onClick={() => download([entry.path])}>
                                <FaDownload size={12} />
                              </button>
                              {previewKind(entry.name) && (
                                <button className="btn-action" title="Vista previa" onClick={() => previewKind(entry.name) === 'pdf' ? window.open(api.content(entry.path, true), '_blank', 'noopener,noreferrer') : setPreview({ path: entry.path, name: entry.name, size: entry.size, modifiedAt: entry.modifiedAt, type: 'file' as const })}>
                                  {previewKind(entry.name) === 'pdf' ? <FaFilePdf size={12} color="#dc2626" /> : <FaEye size={12} />}
                                </button>
                              )}
                              <button className="btn-action" title="Mover" onClick={() => { setNotice('Selecciona un solo archivo para mover. Arrastra archivos o carpetas sobre otra carpeta para moverlos dentro de ella.'); }}>
                                <FaArrowsAlt size={12} />
                              </button>
                              <button className="btn-action btn-delete" title="Eliminar" onClick={() => {
                                if (window.confirm(`¿Enviar «${entry.name}» a la papelera? Puedes restaurarlo después.`)) {
                                  action(() => api.trashFile(entry.path), `«${entry.name}» está en la papelera.`).then(() => setSelected(old => old.filter(path => path !== entry.path)));
                                }
                              }}>
                                <FaTrash size={12} />
                              </button>
                            </>
                          )}
                          {entry.type === 'directory' && (
                            <button className="btn-action" title="Mover" onClick={() => { setNotice('Selecciona un solo archivo para mover. Arrastra archivos o carpetas sobre otra carpeta para moverlos dentro de ella.'); }}>
                              <FaArrowsAlt size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!loading && !error && sorted.length === 0 && (
                      <div className="grid-item grid-empty">
                        <div className="grid-icon"><FaFolderOpen size={32} color="var(--muted2)" /></div>
                        <span className="placeholder">Carpeta vacía — crea una carpeta o sube archivos</span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          ) : view === 'trash' ? (
            <>
              <button className="btn-back" onClick={() => setView('files')}>
                <FaArrowLeft aria-hidden="true" /> Volver a archivos
              </button>
              <section className="card file-table" aria-label="Archivos en papelera">
                <div className="table-head">
                  <div className="col-check" />
                  <div className="col-name">NOMBRE</div>
                  <div className="col-details">DETALLES</div>
                  <div className="col-actions">ACCIONES</div>
                </div>
                {loading && <div className="table-row table-row-full"><div className="table-cell-full"><span className="placeholder">Cargando papelera…</span></div></div>}
                {error && (
                  <div className="table-row table-row-full error-row">
                    <div className="table-cell-full">
                      <div className="table-error"><p>{error}</p><button onClick={refresh}>Reintentar</button></div>
                    </div>
                  </div>
                )}
                {!loading && !error && trash.length === 0 && (
                  <div className="table-row table-row-full">
                    <div className="table-cell-full">
                      <div className="trash-empty">
                        <FaTrash size={32} />
                        <p>La papelera está vacía</p>
                      </div>
                    </div>
                  </div>
                )}
                {!loading && !error && trash.map(item => (
                  <div key={item.id} className="table-row">
                    <div className="col-check" />
                    <div className="col-name">
                      <span className="file-icon"><FaFile aria-hidden="true" /></span>
                      <span className="file-name" title={item.path}>
                        {item.name}
                        <small>Antes: {item.path}</small>
                      </span>
                    </div>
                    <div className="col-details">Eliminado: {date(item.deletedAt)}</div>
                    <div className="col-actions">
                      <button
                        className="btn-action"
                        disabled={saving}
                        onClick={() => action(() => api.restore(item.id), `«${item.name}» restaurado.`)}
                      >
                        <FaUndo aria-hidden="true" /> Restaurar
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <SettingsPanel onExpired={loseSession} />
          )}

          {notice && <p className="notice-bar" role="status" aria-live="polite">{notice}</p>}
        </div>
      </main>

      {/* Preview dialog */}
      {preview && <Preview entry={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default App;