import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  FaFolder, FaFile, FaDownload, FaTrash, FaUndo,
  FaArrowLeft, FaPlus, FaUpload, FaSync,
  FaSignOutAlt, FaCopy, FaQuestionCircle,
  FaSpinner, FaExclamationTriangle, FaFolderOpen,
  FaFilePdf, FaEye, FaArrowsAlt,
  FaPowerOff, FaMoon, FaSun
} from 'react-icons/fa';
import { api, expired, failure, type Entry, type Session, type Status, type TrashEntry } from './api/api';
import { useSSE } from './hooks/useSSE';

const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.ps1', '.reg']);

function isExtensionBlocked(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && BLOCKED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function isExtensionBlockedList(filenames: string[]): string[] {
  return filenames.filter(isExtensionBlocked);
}

const SERVER_SHUTDOWN_KEY = 'cloudlocal-server-shutdown';
function getShutdownState(): { active: boolean; shuttingDown: boolean } {
  try {
    const raw = localStorage.getItem(SERVER_SHUTDOWN_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { active: true, shuttingDown: false };
}
function persistShutdownState(value: { active: boolean; shuttingDown: boolean }) {
  try { localStorage.setItem(SERVER_SHUTDOWN_KEY, JSON.stringify(value)); } catch {}
}
import { Access } from './components/Access';
import { Preview } from './components/Preview';
import { DragAndDrop } from './components/DragAndDrop';
import { SettingsPanel } from './components/Settings';
import { Details } from './components/Details';
import { FileVisual } from './components/FileVisual';
import { classifyExtension } from './components/fileVisuals.mjs';
import { breadcrumbs, bytes, exceedsLimit, previewKind, sortEntries } from './workspace.mjs';

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
  const [revision, setRevision] = useState(0);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [shutdownState, setShutdownState] = useState(getShutdownState());
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const toggleTheme = useCallback(() => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cloudlocal-theme', next); } catch {}
    window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme: next } }));
  }, []);
  // SSE: auto-refresh on file events
  const handleSseEvent = useCallback((_type: string, _data: unknown) => {
    // Any filesystem change → refresh the list
    refresh();
  }, [refresh]);
  useSSE(handleSseEvent);
  const loseSession = useCallback(() => {
    setSession(previous => previous ? { ...previous, authenticated: false } : previous);
    setNotice('La sesión ha caducado. Entra otra vez para continuar.');
  }, []);

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

  const sorted = sortEntries(entries);

  useEffect(() => {
    let active = true;
    api.session()
      .then(value => { if (active) setSession(value); })
      .catch(cause => { if (active) setEntryError(failure(cause)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    setLoading(true); setError('');
    const load = view === 'files' ? api.files(folder, query) : api.trash();
    load
      .then(result => {
        if (!active) return;
        if (view === 'files') setEntries(result as Entry[]);
        else setTrash(result as TrashEntry[]);
      })
      .catch(cause => {
        if (!active) return;
        if (expired(cause)) loseSession();
        else setError(failure(cause));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.authenticated, folder, query, view, revision, loseSession]);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    api.status()
      .then(value => { if (active) setStatus(value); })
      .catch(cause => {
        if (active) {
          if (expired(cause)) loseSession();
          else setNotice(`No se pudo consultar el espacio: ${failure(cause)}`);
        }
      });
    return () => { active = false; };
  }, [session?.authenticated, revision, loseSession]);

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
          action(
            () => api.trashFile(selected[0]),
            `«${selected[0].split('/').at(-1)}» está en la papelera.`,
          ).then(() => setSelected([]));
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
      } else if (
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === 'n' &&
        view === 'files' &&
        !isInputFocused
      ) {
        event.preventDefault();
        event.stopPropagation();
        setFolderName('');
        setCreating(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, sorted, clipboard, preview, renaming, folder, action]);

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

  useEffect(() => {
    const saved = (localStorage.getItem('cloudlocal-theme') as 'dark' | 'light') || 'light';
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    function onThemeChange(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    }
    window.addEventListener('cloudlocal-theme-change', onThemeChange);
    // Sync when localStorage changes from another tab
    function onStorage(event: StorageEvent) {
      if (event.key === 'cloudlocal-theme') {
        if (event.newValue === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('cloudlocal-theme-change', onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // A session response confirms this server is reachable, even before login.
  useEffect(() => {
    if (!session) return;
    const restored = { active: true, shuttingDown: false };
    setShutdownState(restored);
    persistShutdownState(restored);
  }, [session]);

  function onExpired() { loseSession(); }

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
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await task();
      setNotice(success);
      refresh();
    }
    catch (cause) {
      if (expired(cause)) loseSession();
      else setError(failure(cause));
    }
    finally { setSaving(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (saving || !folderName.trim()) return;
    const name = folderName.trim();
    setSaving(true);
    setError('');
    try {
      await api.folder(folder, name);
      setFolderName('');
      setCreating(false);
      setNotice(`Carpeta «${name}» creada.`);
      refresh();
    }
    catch (cause) {
      if (expired(cause)) loseSession();
      else setError(failure(cause));
    }
    finally { setSaving(false); }
  }
  function download(paths: string[]) {
    for (const path of paths) {
      const link = document.createElement('a');
      link.href = api.content(path);
      link.download = path.split('/').at(-1) || 'archivo';
      document.body.append(link);
      link.click();
      link.remove();
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
  if (!session)
    return <main className="auth-gate" role="status">
      {entryError ? <>
        <p className="error-text">{entryError}</p>
        <button
          className="btn-retry"
          onClick={() => {
            setEntryError('');
            api.session()
              .then(setSession)
              .catch(cause => setEntryError(failure(cause)));
          }}
        >
          Reintentar conexión
        </button>
      </> : <p>Conectando con CloudLocal…</p>}
    </main>;
  if (!session.authenticated)
    return <>
      <Access
        session={session}
        onAccess={() => {
          setSession({ ...session, configured: true, authenticated: true });
          refresh();
        }}
      />
      {notice && <p className="session-notice" role="status">{notice}</p>}
    </>;
  const crumbs = breadcrumbs(folder);
  const inspectorEntry = selected.length === 1
    ? entries.find(entry => entry.path === selected[0]) ?? null
    : null;

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Navegación principal">
        <button
          className="rail-brand"
          aria-label="CloudLocal, ir a Archivos"
          onClick={() => setView('files')}
        >
          <img src="/cloudlocal.svg" alt="" />
        </button>

        <nav className="rail-nav" aria-label="Secciones">
          <button
            className={`rbtn${view === 'files' ? ' active' : ''}`}
            aria-current={view === 'files' ? 'page' : undefined}
            aria-label="Archivos"
            onClick={() => setView('files')}
          >
            <FaFolder aria-hidden="true" />
            <span className="railtip">Archivos</span>
          </button>
          <button
            className={`rbtn${view === 'trash' ? ' active' : ''}`}
            aria-current={view === 'trash' ? 'page' : undefined}
            aria-label="Papelera"
            onClick={() => { setView('trash'); setSelected([]); setPreview(null); }}
          >
            <FaTrash aria-hidden="true" />
            <span className="railtip">Papelera</span>
          </button>
          <button
            className={`rbtn${view === 'settings' ? ' active' : ''}`}
            aria-current={view === 'settings' ? 'page' : undefined}
            aria-label="Configuración"
            onClick={() => { setView('settings'); setSelected([]); setPreview(null); }}
          >
            <FaQuestionCircle aria-hidden="true" />
            <span className="railtip">Configuración</span>
          </button>
        </nav>

        <div className="rail-spacer" />

        <span className="rail-status" title="El servidor debe permanecer encendido y despierto">
          <span className="status-dot" aria-hidden="true" />
          <span className="sr-only">Servidor local activo</span>
        </span>

        <button className="rbtn" aria-label="Cambiar de tema" aria-pressed={false} onClick={toggleTheme}>
          <FaMoon className="rail-theme-icon rail-theme-moon" aria-hidden="true" />
          <FaSun className="rail-theme-icon rail-theme-sun" aria-hidden="true" />
          <span className="railtip">Tema</span>
        </button>

        <button
          className="rbtn"
          aria-label="Cerrar sesión"
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
          <span className="railtip">Cerrar sesión</span>
        </button>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
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

            <div>
              <h1 className="page-title">
                {view === 'trash' ? 'Papelera' : view === 'settings' ? 'Configuración' : 'Mis archivos'}
              </h1>
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
                    <rect x="2" y="2" width="12" height="2" rx="0.5" fill="currentColor" />
                    <rect x="2" y="7" width="12" height="2" rx="0.5" fill="currentColor" />
                    <rect x="2" y="12" width="12" height="2" rx="0.5" fill="currentColor" />
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
                    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                </button>
              </div>
            )}

            <button
              className="btn-icon"
              onClick={() => setCreating(value => !value)}
              title="Nueva carpeta (Ctrl+Alt+N)"
              aria-keyshortcuts="Control+Alt+N"
            >
              <FaPlus aria-hidden="true" />
              <span className="btn-label">Nueva carpeta</span>
              <span className="shortcut-hint">Ctrl+Alt+N</span>
            </button>

            <label className={`btn-upload button-like${uploadBusy ? ' busy' : ''}`} title="Elegir archivos para subir">
              <FaUpload aria-hidden="true" />
              <span className="btn-label">Elegir archivos</span>
              <input
                type="file"
                multiple
                onChange={e => {
                  if (e.target.files?.length) selectFilePickerFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
                disabled={uploadBusy}
                aria-label="Elegir archivos para subir"
              />
            </label>

            <button
              className="btn-danger topbar-shutdown"
              disabled={shutdownState.shuttingDown || !shutdownState.active}
              onClick={async () => {
                setShutdownState(prev => ({ ...prev, shuttingDown: true }));
                persistShutdownState({ ...shutdownState, shuttingDown: true });
                try {
                  await api.shutdown();
                  setShutdownState({ active: false, shuttingDown: false });
                  persistShutdownState({ active: false, shuttingDown: false });
                } catch (cause) {
                  setError(failure(cause));
                  setShutdownState({ active: true, shuttingDown: false });
                  persistShutdownState({ active: true, shuttingDown: false });
                }
              }}
            >
              <FaPowerOff aria-hidden="true" />
              <span className="btn-label">{shutdownState.shuttingDown ? 'Apagando…' : 'Detener Server'}</span>
            </button>

            <button className="btn-ghost" onClick={async () => {
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
            }}>
              <FaSignOutAlt aria-hidden="true" />
              <span className="btn-label">Cerrar sesión</span>
            </button>
          </div>
        </header>
        <div className="workspace-body">
          {view === 'files' ? (
            <>
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
                    {query && (
                      <button className="btn-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">✕</button>
                    )}
                  </div>
                  <button
                    className="btn-icon btn-refresh"
                    onClick={refresh}
                    disabled={loading}
                    title="Actualizar"
                  >
                    <FaSync aria-hidden="true" />
                    <span className="btn-label">Actualizar</span>
                  </button>
                </div>
              </div>
              {creating && (
                <form className="card folder-form" onSubmit={create}>
                  <h3>Nueva carpeta</h3>
                  <div className="form-row">
                    <input
                      id="folder-name"
                      autoFocus
                      value={folderName}
                      onChange={e => setFolderName(e.target.value)}
                      required
                      maxLength={255}
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
              <section className="card card-upload" aria-label="Subir archivos">
                <div className="card-content">
                  <h3>Subir archivos</h3>
                  <p>
                    {status
                      ? `Sube archivos aquí. Tamaño máximo por archivo: ${bytes(status.maxUploadBytes)}.`
                      : 'Sube tus archivos aquí.'}
                  </p>
                  <div className="upload-warning">
                    <FaExclamationTriangle size={13} />
                    <span>Algunos tipos de archivo no están permitidos</span>
                  </div>
                  <div className="upload-actions-row">
                    <label className={`btn-accent button-like${uploadBusy ? ' busy' : ''}`}>
                      <FaUpload aria-hidden="true" />
                      <span>Elegir archivos</span>
                      <input
                        type="file"
                        multiple
                        onChange={e => {
                          if (e.target.files?.length) selectFilePickerFiles(Array.from(e.target.files));
                          e.target.value = '';
                        }}
                        disabled={uploadBusy}
                        aria-label="Elegir archivos para subir"
                      />
                    </label>
                  </div>
                </div>
              </section>
              <DragAndDrop onFilesDropped={enqueueFiles} folderPath={folder || 'inicio'} />
              {fileView === 'list' ? (
                <section
                  className="card file-table"
                  aria-label="Contenido de la carpeta"
                  onDragEnter={e => {
                    if (e.dataTransfer?.types?.includes('Files')) e.currentTarget.classList.add('drag-active');
                  }}
                  onDragLeave={e => {
                    const rel = e.relatedTarget as HTMLElement | null;
                    if (rel instanceof HTMLElement && e.currentTarget.contains(rel)) return;
                    e.currentTarget.classList.remove('drag-active');
                  }}
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

                  {loading && (
                    <div className="table-row loading-row">
                      <div className="col-check" />
                      <div className="col-name">
                        <span className="placeholder">Cargando archivos…</span>
                      </div>
                      <div className="col-details" />
                      <div className="col-actions" />
                    </div>
                  )}

                  {error && !loading && (
                    <div className="table-row error-row">
                      <div className="col-check" />
                      <div className="col-name">
                        <div className="table-error">
                          <p>{error}</p>
                          <button onClick={refresh}>Reintentar</button>
                        </div>
                      </div>
                      <div className="col-details" />
                      <div className="col-actions" />
                    </div>
                  )}

                  {!loading && !error && sorted.length === 0 && (
                    <div className="table-row table-row-full">
                      <div className="table-cell-full">
                        <span className="placeholder">
                          {query
                            ? 'No hay coincidencias en esta carpeta.'
                            : 'Esta carpeta está vacía. Puedes crear una carpeta o subir archivos.'}
                        </span>
                      </div>
                    </div>
                  )}

                  {!loading && !error && sorted.map(entry => (
                    <div
                      key={entry.path}
                      className={`table-row entry${dragOver === entry.path ? ' drag-target' : ''}`}
                      draggable={entry.type === 'file' || entry.type === 'directory'}
                      onClick={event => {
                        const target = event.target as HTMLElement;
                        if (target.closest('button, a, input, textarea')) return;
                        setSelected(old => old.length === 1 && old[0] === entry.path ? [] : [entry.path]);
                      }}
                      onDragStart={e => {
                        e.stopPropagation();
                        const dt = e.dataTransfer;
                        dt.setData('application/x-cloudlocal-move', entry.path);
                        dt.effectAllowed = 'move';
                      }}
                    >
                      <div className="col-check">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${entry.name}`}
                          checked={selected.includes(entry.path)}
                          disabled={entry.type === 'directory'}
                          onChange={e =>
                            entry.type === 'file' &&
                            setSelected(old =>
                              e.target.checked
                                ? [...old, entry.path]
                                : old.filter(path => path !== entry.path)
                            )
                          }
                        />
                      </div>
                      <div
                        className="col-name"
                        onDragEnter={e => {
                          if (entry.type !== 'directory') return;
                          e.stopPropagation();
                          setDragOver(entry.path);
                        }}
                        onDragLeave={() => {
                          if (entry.type !== 'directory') return;
                          setDragOver(null);
                        }}
                        onDragOver={e => {
                          if (entry.type !== 'directory') return;
                          e.preventDefault();
                          const dt = e.dataTransfer;
                          dt.dropEffect = 'move';
                        }}
                        onDrop={e => {
                          if (entry.type !== 'directory') return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOver(null);
                          const movedPath = e.dataTransfer?.getData('application/x-cloudlocal-move');
                          if (movedPath) { movePath(movedPath, entry.path); }
                        }}
                      >
                        {entry.type === 'directory'
                          ? <FaFolder aria-hidden="true" />
                          : <FileVisual path={entry.path} contentUrl={api.content(entry.path, true)} view={fileView} className="file-icon" />}

                        {renaming?.path === entry.path ? (
                          <input
                            className="rename-input"
                            value={renameInput}
                            onChange={e => setRenameInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') submitRename();
                              if (e.key === 'Escape') { setRenaming(null); setRenameInput(''); }
                            }}
                            onBlur={submitRename}
                            autoFocus
                            title={entry.name}
                          />
                        ) : entry.type === 'directory' ? (
                          <button
                            onClick={() => go(entry.path)}
                            onDoubleClick={() => startRename(entry.path, entry.name)}
                            className="file-name"
                            title={entry.name}
                          >
                            {entry.name}
                          </button>
                        ) : (
                          <span
                            onDoubleClick={() => startRename(entry.path, entry.name)}
                            className="file-name"
                            title={entry.name}
                          >
                            {entry.name}
                          </span>
                        )}
                      </div>
                      <div className="col-details" title={entry.type === 'file'
                          ? `${bytes(entry.size)} · ${date(entry.modifiedAt)}`
                          : `Carpeta · ${date(entry.modifiedAt)}`}>
                        {entry.type === 'file'
                          ? `${bytes(entry.size)} · ${date(entry.modifiedAt)}`
                          : `Carpeta · ${date(entry.modifiedAt)}`}
                      </div>
                      <div className="col-actions">
                        {entry.type === 'file' ? (
                          <span className="action-group">
                            {previewKind(entry.name) && (
                              <button
                                className="btn-action"
                                onClick={() =>
                                  previewKind(entry.name) === 'pdf'
                                    ? window.open(api.content(entry.path, true), '_blank', 'noopener,noreferrer')
                                    : setPreview(entry)
                                }
                                title="Vista previa"
                                aria-label={'Vista previa de ' + entry.name}
                              >
                                <FaEye aria-hidden="true" />
                              </button>
                            )}
                            <a
                              href={api.content(entry.path)}
                              download={entry.name}
                              className="btn-action"
                              title={`Descargar ${entry.name}`}
                              aria-label={'Descargar ' + entry.name}
                            >
                              <FaDownload aria-hidden="true" />
                            </a>
                            <button
                              className="btn-action btn-delete"
                              disabled={saving}
                              onClick={() => {
                                if (window.confirm(`¿Enviar «${entry.name}» a la papelera? Puedes restaurarlo después.`)) {
                                  action(
                                    () => api.trashFile(entry.path),
                                    `«${entry.name}» está en la papelera.`
                                  ).then(() =>
                                    setSelected(old => old.filter(path => path !== entry.path))
                                  );
                                }
                              }}
                              title={`Enviar ${entry.name} a papelera`}
                              aria-label={'Enviar ' + entry.name + ' a papelera'}
                            >
                              <FaTrash aria-hidden="true" />
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </section>
              ) : (
                /* ── File grid view ───────────────────────────────────────── */
                <section
                  className="card file-grid"
                  aria-label="Contenido de la carpeta"
                  onDragEnter={e => {
                    if (e.dataTransfer?.types?.includes('Files')) e.currentTarget.classList.add('drag-active');
                  }}
                  onDragLeave={e => {
                    const rel = e.relatedTarget as HTMLElement | null;
                    if (rel instanceof HTMLElement && e.currentTarget.contains(rel)) return;
                    e.currentTarget.classList.remove('drag-active');
                  }}
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
                        <div className="grid-icon">
                          <FaSpinner className="fa-spin" size={24} />
                        </div>
                        <span className="placeholder">Cargando…</span>
                      </div>
                    )}

                    {error && (
                      <div className="grid-item grid-error">
                        <div className="grid-icon">
                          <FaExclamationTriangle size={24} />
                        </div>
                        <span className="error-text">{error}</span>
                        <button onClick={refresh} className="btn-action">Reintentar</button>
                      </div>
                    )}

                    {sorted.map(entry => (
                      <div
                        key={entry.path}
                        className={`grid-item entry${selected.includes(entry.path) ? ' selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(old =>
                            selected.includes(entry.path)
                              ? old.filter(p => p !== entry.path)
                              : [...old, entry.path]
                          );
                        }}
                        onDoubleClick={() =>
                          entry.type === 'directory'
                            ? go(entry.path)
                            : startRename(entry.path, entry.name)
                        }
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-cloudlocal-move', entry.path);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          if (entry.type === 'directory') {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOver(entry.path);
                          }
                        }}
                        onDragLeave={() => {
                          if (entry.type === 'directory') setDragOver(null);
                        }}
                        onDrop={(e) => {
                          if (entry.type !== 'directory') return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOver(null);
                          const movedPath = e.dataTransfer?.getData('application/x-cloudlocal-move');
                          if (movedPath) { movePath(movedPath, entry.path); }
                        }}
                        tabIndex={0}
                        role="listitem"
                        aria-label={`${entry.name}${entry.type === 'directory' ? ' carpeta' : ' archivo'}`}
                        aria-selected={selected.includes(entry.path)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(old =>
                              selected.includes(entry.path)
                                ? old.filter(p => p !== entry.path)
                                : [...old, entry.path]
                            );
                          }
                        }}
                      >
                        <div
                          className="grid-icon"
                          data-icon-type={
                            entry.type === 'directory'
                              ? 'folder'
                              : classifyExtension(entry.name)
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            entry.type === 'directory'
                              ? go(entry.path)
                              : startRename(entry.path, entry.name);
                          }}
                        >
                          {entry.type === 'directory'
                            ? <FaFolder aria-hidden="true" />
                            : <FileVisual path={entry.path} contentUrl={api.content(entry.path, true)} view={fileView} />}
                        </div>
                        <div className="grid-check">
                          <input
                            type="checkbox"
                            checked={selected.includes(entry.path)}
                            onChange={() =>
                              setSelected(old =>
                                selected.includes(entry.path)
                                  ? old.filter(p => p !== entry.path)
                                  : [...old, entry.path]
                              )
                            }
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
                            />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(entry.path, entry.name);
                              }}
                              title={entry.name}
                            >
                              {entry.name}
                            </button>
                          )}
                          {entry.type === 'directory' && <small>{bytes(entry.size)}</small>}
                        </span>
                        <div className="grid-actions">
                          {entry.type === 'file' && (
                            <>
                              <button
                                className="btn-action"
                                aria-label={'Descargar ' + entry.name}
                                title="Descargar"
                                onClick={() => download([entry.path])}
                              >
                                <FaDownload size={12} />
                              </button>
                              {previewKind(entry.name) && (
                                <button
                                  className="btn-action"
                                  aria-label={'Vista previa de ' + entry.name}
                                title="Vista previa"
                                  onClick={() =>
                                    previewKind(entry.name) === 'pdf'
                                      ? window.open(
                                          api.content(entry.path, true),
                                          '_blank',
                                          'noopener,noreferrer'
                                        )
                                      : setPreview({
                                          path: entry.path,
                                          name: entry.name,
                                          size: entry.size,
                                          modifiedAt: entry.modifiedAt,
                                          type: 'file' as const,
                                        })
                                  }
                                >
                                  {previewKind(entry.name) === 'pdf' ? (
                                    <FaFilePdf size={12} color="var(--danger)" />
                                  ) : (
                                    <FaEye size={12} />
                                  )}
                                </button>
                              )}
                              <button
                                className="btn-action"
                                aria-label={'Mover ' + entry.name}
                                title="Mover"
                                onClick={() => {
                                  setNotice('Selecciona un solo archivo para mover. Arrastra archivos o carpetas sobre otra carpeta para moverlos dentro de ella.');
                                }}
                              >
                                <FaArrowsAlt size={12} />
                              </button>
                              <button
                                className="btn-action btn-delete"
                                aria-label={'Eliminar ' + entry.name}
                                title="Eliminar"
                                onClick={() => {
                                  if (window.confirm(`¿Enviar «${entry.name}» a la papelera? Puedes restaurarlo después.`)) {
                                    action(
                                      () => api.trashFile(entry.path),
                                      `«${entry.name}» está en la papelera.`
                                    ).then(() =>
                                      setSelected(old => old.filter(path => path !== entry.path))
                                    );
                                  }
                                }}
                              >
                                <FaTrash size={12} />
                              </button>
                            </>
                          )}
                          {entry.type === 'directory' && (
                            <button
                              className="btn-action"
                              aria-label={'Mover ' + entry.name}
                                title="Mover"
                              onClick={() => {
                                setNotice('Selecciona un solo archivo para mover. Arrastra archivos o carpetas sobre otra carpeta para moverlos dentro de ella.');
                              }}
                            >
                              <FaArrowsAlt size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {!loading && !error && sorted.length === 0 && (
                      <div className="grid-item grid-empty">
                        <div className="grid-icon">
                          <FaFolderOpen size={32} color="var(--muted2)" />
                        </div>
                        <span className="placeholder">
                          Carpeta vacía — crea una carpeta o sube archivos
                        </span>
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

                {loading && (
                  <div className="table-row table-row-full">
                    <div className="table-cell-full">
                      <span className="placeholder">Cargando papelera…</span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="table-row table-row-full error-row">
                    <div className="table-cell-full">
                      <div className="table-error">
                        <p>{error}</p>
                        <button onClick={refresh}>Reintentar</button>
                      </div>
                    </div>
                  </div>
                )}

                {!loading && !error && trash.length === 0 && (
                  <div className="table-row table-row-full">
                    <div className="table-cell-full">
                      <div className="trash-empty">
                        <span className="file-icon" style={{width: '32px', height: '32px', fontSize: '32px'}}>
                          <FaTrash aria-hidden="true" />
                        </span>
                        <p>La papelera está vacía</p>
                      </div>
                    </div>
                  </div>
                )}

                {!loading && !error && trash.map(item => (
                  <div key={item.id} className="table-row">
                    <div className="col-check" />
                    <div className="col-name">
                      <span className="file-icon">
                        <FaFile aria-hidden="true" />
                      </span>
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
                        onClick={() =>
                          action(() => api.restore(item.id), `«${item.name}» restaurado.`)
                        }
                        title="Restaurar"
                        aria-label={'Restaurar ' + item.name}
                      >
                        <FaUndo aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <SettingsPanel onExpired={loseSession} />
          )}
          {notice && (
            <p className="notice-bar" role="status" aria-live="polite">
              {notice}
            </p>
          )}
        </div>
      </div>

      {inspectorEntry && view === 'files' && (
        <Details
          entry={inspectorEntry}
          onOpen={() => {
            if (inspectorEntry.type === 'directory') go(inspectorEntry.path);
            else setPreview(inspectorEntry);
          }}
          onDownload={() => download([inspectorEntry.path])}
          onRename={() => startRename(inspectorEntry.path, inspectorEntry.name)}
          onDelete={() => {
            if (!window.confirm(`¿Enviar «${inspectorEntry.name}» a la papelera? Puedes restaurarlo después.`)) return;
            action(() => api.trashFile(inspectorEntry.path), `«${inspectorEntry.name}» está en la papelera.`)
              .then(() => setSelected([]));
          }}
        />
      )}
      {preview && <Preview entry={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default App;