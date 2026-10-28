import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { blobatar } from 'blobatar/blob';
import {
  FaFolder, FaFile, FaDownload, FaTrash, FaUndo,
  FaArrowLeft, FaPlus, FaUpload, FaSync,
  FaSignOutAlt, FaCopy, FaQuestionCircle,
  FaSpinner, FaExclamationTriangle, FaFolderOpen,
  FaFilePdf, FaEye, FaArrowsAlt,
  FaPowerOff, FaMoon, FaSun, FaHistory
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

const AVATAR_SEED_KEY = 'cloudlocal-avatar-seed';
function createAvatar(): string {
  let seed: string;
  try {
    seed = localStorage.getItem(AVATAR_SEED_KEY) || '';
    if (!seed) {
      seed = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      localStorage.setItem(AVATAR_SEED_KEY, seed);
    }
  } catch {
    seed = Math.random().toString(36).slice(2);
  }
  return blobatar(seed, { background: 'circle', hue: 174 });
}

const SERVER_SHUTDOWN_KEY = 'cloudlocal-server-shutdown';
function readShutdownState(): { active: boolean; shuttingDown: boolean } | null {
  try {
    const raw = localStorage.getItem(SERVER_SHUTDOWN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (cause) {
    console.warn('No se pudo leer el estado del servidor', cause);
    return null;
  }
}
function getShutdownState(): { active: boolean; shuttingDown: boolean } {
  return readShutdownState() ?? { active: true, shuttingDown: false };
}
function persistShutdownState(value: { active: boolean; shuttingDown: boolean }) {
  try {
    localStorage.setItem(SERVER_SHUTDOWN_KEY, JSON.stringify(value));
  } catch (cause) {
    console.warn('No se pudo guardar el estado del servidor', cause);
  }
}
import { Access } from './components/Access';
import { Preview } from './components/Preview';
import { DragAndDrop } from './components/DragAndDrop';
import { SettingsPanel } from './components/Settings';
import { Details, type ActivityEvent } from './components/Details';
import { MultiDetails } from './components/MultiDetails';
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

type TypeFilter = 'all' | 'image' | 'video' | 'document';

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'image', label: 'Imágenes' },
  { id: 'video', label: 'Vídeo' },
  { id: 'document', label: 'Documentos' },
];

const DOCUMENT_KINDS = new Set(['pdf', 'word', 'excel', 'powerpoint', 'text']);

function matchesTypeFilter(kind: string, filter: TypeFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'document' ? DOCUMENT_KINDS.has(kind) : kind === filter;
}

// Newest first; entries with an unreadable date sink to the end.
function sortByModifiedAt(entries: Entry[]): Entry[] {
  const time = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return [...entries].sort((a, b) => time(b.modifiedAt) - time(a.modifiedAt) ||
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }));
}

function date(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '—' : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

function App() {
  const [avatar] = useState(createAvatar);
  const [session, setSession] = useState<Session | null>(null);
  const [entryError, setEntryError] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<View>('files');
  const [fileView, setFileView] = useState<'list' | 'grid'>('list');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [recentMode, setRecentMode] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [moving, setMoving] = useState<{ path: string; type: 'file' | 'directory' }[] | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [moveEntries, setMoveEntries] = useState<Entry[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveBrowseError, setMoveBrowseError] = useState('');
  const moveDialogRef = useRef<HTMLDialogElement>(null);
  const moveListRef = useRef<HTMLDivElement>(null);
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
    try {
      localStorage.setItem('cloudlocal-theme', next);
    } catch (cause) {
      console.warn('No se pudo guardar el tema', cause);
    }
    window.dispatchEvent(new CustomEvent('cloudlocal-theme-change', { detail: { theme: next } }));
  }, []);
  // SSE: keep a short activity log and auto-refresh on file events.
  const handleSseEvent = useCallback((type: string, data: unknown) => {
    let path = '';
    if (data && typeof data === 'object') {
      const payload = data as { path?: unknown; to?: unknown };
      if (typeof payload.path === 'string') path = payload.path;
      else if (typeof payload.to === 'string') path = payload.to;
    }
    setActivity(previous => [{ type, path, at: Date.now() }, ...previous].slice(0, 20));
    refresh();
  }, [refresh]);
  useSSE(handleSseEvent);
  useEffect(() => {
    const dialog = moveDialogRef.current;
    if (!dialog) return;
    if (moving && !dialog.open) dialog.showModal();
    if (!moving && dialog.open) dialog.close();
  }, [moving]);

  function openMove(paths: string[]) {
    if (paths.length === 0) return;
    const items = paths.map(path => {
      const found = entries.find(entry => entry.path === path);
      return { path, type: (found?.type ?? 'file') as 'file' | 'directory' };
    });
    setMoving(items);
    setMoveTarget(folder);
    setMoveEntries([]);
    setMoveBrowseError('');
    setError('');
  }

  // The destination is the folder currently on screen in the dialog.
  const moveCrumbs = moveTarget.split('/').filter(Boolean);
  const moveParent = moveCrumbs.slice(0, -1).join('/');
  const moveFolders = moveEntries.filter(entry => entry.type === 'directory');
  // A folder cannot be sent into itself or into any of its own subfolders.
  function isMoveBlocked(path: string): boolean {
    return (moving ?? []).some(item =>
      item.type === 'directory' && (path === item.path || path.startsWith(item.path + '/'))
    );
  }

  async function submitMove() {
    if (!moving) return;
    // The destination must be a folder we actually loaded.
    if (moveLoading) {
      setError('Espera a que termine de cargarse la carpeta de destino.');
      return;
    }
    if (moveBrowseError) {
      setError('No se pudo leer la carpeta de destino. Elige otra carpeta.');
      return;
    }
    const target = moveTarget.trim();
    const insideItself = moving.some(item => item.path === target || target.startsWith(item.path + '/'));
    if (target !== '' && insideItself) {
      setError('No puedes mover una carpeta dentro de sí misma.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const item of moving) {
        if (item.type === 'directory') await api.moveFolderInto(item.path, target);
        else await api.moveFileInto(item.path, target);
      }
      const label = moving.length === 1 ? `«${moving[0].path.split('/').at(-1)}»` : `${moving.length} elementos`;
      setNotice(`${label} movido${moving.length === 1 ? '' : 's'} a ${target || 'Inicio'}.`);
      setMoving(null);
      setSelected([]);
      refresh();
    } catch (cause: unknown) {
      if (expired(cause)) loseSession();
      else setError(failure(cause));
    } finally {
      setSaving(false);
    }
  }

  const loseSession = useCallback(() => {
    setSession(previous => previous ? { ...previous, authenticated: false } : previous);
    setNotice('La sesión ha caducado. Entra otra vez para continuar.');
  }, []);

  const [uploadBusy, setUploadBusy] = useState(false);
  const cancelUploadRef = useRef(false);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadNextId = useRef(0);
  const pendingUploadsRef = useRef<{ file: File; id: number; folder: string }[]>([]);
  const isUploadingRef = useRef(false);
  const MAX_RECONNECT = 3;

  function updateUploadItem(id: number, patch: Partial<UploadItem>) {
    setUploads(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function enqueueFiles(files: File[], folderPath: string) {
    const blockedNames = isExtensionBlockedList(files.map(f => f.name));
    if (blockedNames.length > 0) {
      setError(`No se permiten los siguientes tipos de archivo: ${blockedNames.join(', ')}`);
      return;
    }
    const batch = files.map(file => ({ file, id: ++uploadNextId.current, folder: folderPath }));
    setUploads(previous => [
      ...batch.map(item => ({ id: item.id, name: item.file.name, state: 'En cola', progress: 0 })),
      ...previous,
    ].slice(0, 6));
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

  const typeCounts: Record<TypeFilter, number> = { all: entries.length, image: 0, video: 0, document: 0 };
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const kind = classifyExtension(entry.name);
    if (kind === 'image') typeCounts.image += 1;
    else if (kind === 'video') typeCounts.video += 1;
    else if (DOCUMENT_KINDS.has(kind)) typeCounts.document += 1;
  }
  const filteredEntries = entries.filter(entry =>
    typeFilter === 'all' || (entry.type === 'file' && matchesTypeFilter(classifyExtension(entry.name), typeFilter))
  );
  const sorted = recentMode ? sortByModifiedAt(filteredEntries) : sortEntries(filteredEntries);
  const recentlyAdded = fileView === 'grid' && sorted.length >= 2 ? sortByModifiedAt(sorted).slice(0, 4) : [];

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
  // Browse the real folder tree while the move dialog is open.
  useEffect(() => {
    if (!moving) return;
    let active = true;
    setMoveLoading(true);
    setMoveBrowseError('');
    api.files(moveTarget, '')
      .then(list => { if (active) setMoveEntries(list); })
      .catch(cause => {
        if (!active) return;
        if (expired(cause)) loseSession();
        else setMoveBrowseError(failure(cause));
      })
      .finally(() => {
        if (!active) return;
        setMoveLoading(false);
        // Keep keyboard users inside the dialog after the folder list changes.
        moveListRef.current?.focus({ preventScroll: true });
      });
    return () => { active = false; };
  }, [moving, moveTarget, loseSession]);

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
        !recentMode &&
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
  }, [selected, sorted, clipboard, preview, renaming, folder, action, recentMode]);

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
    const invalidChars = /[/:*?"<>|\\]/;
    if (invalidChars.test(newName)) {
      setError('El nombre no puede contener: / \\ : * ? " < > |');
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
  // The inspector follows the selection: one entry keeps the original Details
  // panel, two or more keep a summary of the whole selection, none hides it.
  const selectedEntries = selected
    .map(path => entries.find(entry => entry.path === path))
    .filter((entry): entry is Entry => Boolean(entry));
  const inspectorEntry = selected.length === 1 ? selectedEntries[0] ?? null : null;
  const multiSelection = selected.length > 1 && selectedEntries.length === selected.length && view === 'files'
    ? selectedEntries
    : null;

  return (
    <div className={`app-shell${(inspectorEntry && view === 'files') || multiSelection ? ' has-inspector' : ''}`}>
      <aside className="rail" aria-label="Navegación principal">
        <button
          className="rail-brand"
          aria-label="CloudLocal, ir a Archivos"
          onClick={() => { setView('files'); setRecentMode(false); }}
        >
          <img src="/cloudlocal.svg" alt="" />
        </button>

        <nav className="rail-nav" aria-label="Secciones">
          <button
            className={`rbtn${view === 'files' && !recentMode ? ' active' : ''}`}
            aria-current={view === 'files' && !recentMode ? 'page' : undefined}
            aria-label="Archivos"
            onClick={() => { setView('files'); setRecentMode(false); }}
          >
            <FaFolder aria-hidden="true" />
            <span className="railtip">Archivos</span>
          </button>
          <button
            className={`rbtn${view === 'files' && recentMode ? ' active' : ''}`}
            aria-current={view === 'files' && recentMode ? 'page' : undefined}
            aria-label="Recientes"
            onClick={() => { setView('files'); setRecentMode(true); setCreating(false); setSelected([]); setPreview(null); }}
          >
            <FaHistory aria-hidden="true" />
            <span className="railtip">Recientes</span>
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
        <span className="rail-avatar" aria-hidden="true" dangerouslySetInnerHTML={{ __html: avatar }} />
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
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
                {view === 'trash' ? 'Papelera' : view === 'settings' ? 'Configuración' : recentMode ? 'Recientes' : 'Mis archivos'}
              </h1>
              {view === 'trash' && <p className="page-subtitle">Restaura o elimina permanentemente los archivos borrados.</p>}
              {view === 'files' && recentMode && (
                <p className="page-subtitle">Ordenados por fecha de modificación en esta carpeta.</p>
              )}
            </div>
          </div>

          {view === 'files' && (
          <div className="topbar-actions">
            {clipboard && (
              <button className="btn-icon" onClick={() => handlePaste(folder)} title="Pegar en esta carpeta">
                <FaCopy aria-hidden="true" />
                <span className="btn-label">Pegar</span>
              </button>
            )}

            {!recentMode && (
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
            )}

            <label className={`btn-upload button-like${uploadBusy ? ' busy' : ''}`} title="Elegir archivos para subir">
              <FaUpload aria-hidden="true" />
              <span className="btn-label">Subir</span>
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
              aria-label={shutdownState.shuttingDown ? 'Apagando el servidor' : 'Apagar servidor'}
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
              <span className="btn-label">{shutdownState.shuttingDown ? 'Apagando…' : 'Apagar'}</span>
            </button>

          </div>
          )}
        </header>
        <div className="workspace-body">
          {view === 'files' ? (
            <>
              <div className="toolbar files-toolbar">
                {folder !== '' && (
                  <button className="btn-back" onClick={() => go(folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '')}>
                    <FaArrowLeft aria-hidden="true" /> Volver
                  </button>
                )}
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
                <div className="type-chips" role="group" aria-label="Filtrar por tipo de archivo">
                  {TYPE_FILTERS.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className="chip"
                      aria-pressed={typeFilter === option.id}
                      onClick={() => setTypeFilter(option.id)}
                    >
                      {option.label}
                      <span className="chip-count">{typeCounts[option.id]}</span>
                    </button>
                  ))}
                </div>
                <span className="toolbar-gap" aria-hidden="true" />
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
              </div>
              {creating && !recentMode && (
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
                  <button onClick={() => openMove(selected)}>
                    <FaFolder aria-hidden="true" /> Mover
                  </button>
                  <button className="btn-danger" onClick={() => setSelected([])}>
                    Limpiar selección
                  </button>
                </div>
              )}
              {!recentMode && (
              <div className="upload-bar" aria-label="Subir archivos">
                <span className="upload-bar-icon" aria-hidden="true"><FaUpload /></span>
                <div className="upload-bar-text">
                  <strong>Subir archivos</strong>
                  <span>{status ? `Máximo ${bytes(status.maxUploadBytes)} por archivo` : 'Arrastra o elige archivos'}</span>
                </div>
                <span className="upload-bar-limit">
                  <FaExclamationTriangle aria-hidden="true" />
                  .exe, .bat y similares bloqueados
                </span>
                <label className={`upload-bar-btn${uploadBusy ? ' busy' : ''}`}>
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
              )}
              {uploads.length > 0 && (
                <div className="upload-list" aria-live="polite" aria-label="Subidas en curso">
                  {uploads.map(item => (
                    <div
                      key={item.id}
                      className={`upload-item ${
                        /subido|completado/i.test(item.state) ? 'state-done'
                          : /cancelado/i.test(item.state) ? 'state-paused'
                            : /error|no se pudo|supera|sesión/i.test(item.state) ? 'state-error'
                              : 'state-uploading'
                      }`}
                    >
                      <div className="upload-item-head">
                        <span className="upload-name" title={item.name}>{item.name}</span>
                        <span className="upload-status">{item.state}</span>
                        {item.progress > 0 && <span className="upload-progress-text">{item.progress}%</span>}
                      </div>
                      <div className="upload-progress-bar">
                        <div style={{ width: `${Math.min(item.progress, 100)}%` }} />
                      </div>
                      {item.error && <span className="upload-error">{item.error}</span>}
                    </div>
                  ))}
                </div>
              )}
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
                    <div className="col-modified">MODIFICADO</div>
                    <div className="col-size">TAMAÑO</div>
                    <div className="col-actions">ACCIONES</div>
                  </div>

                  {loading && (
                    <div className="table-row loading-row">
                      <div className="col-check" />
                      <div className="col-name">
                        <span className="placeholder">Cargando archivos…</span>
                      </div>
                      <div className="col-modified" />
                      <div className="col-size" />
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
                      <div className="col-modified" />
                      <div className="col-size" />
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
                                            <div className="col-modified">{date(entry.modifiedAt)}</div>
                      <div className="col-size">{entry.type === 'file' ? bytes(entry.size) : '—'}</div>
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
                        ) : (
                          <span className="action-group">
                            <button
                              className="btn-action btn-delete"
                              disabled={saving}
                              onClick={() => {
                                if (window.confirm(`¿Enviar la carpeta «${entry.name}» y todo su contenido a la papelera?`)) {
                                  action(
                                    () => api.trashFile(entry.path),
                                    `«${entry.name}» está en la papelera.`
                                  ).then(() => setSelected(old => old.filter(path => path !== entry.path)));
                                }
                              }}
                              title={`Enviar ${entry.name} a papelera`}
                              aria-label={'Enviar ' + entry.name + ' a papelera'}
                            >
                              <FaTrash aria-hidden="true" />
                            </button>
                          </span>
                        )}
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
                            if (entry.type === 'directory') go(entry.path);
                            else startRename(entry.path, entry.name);
                          }}
                        >
                          {entry.type === 'directory'
                            ? <FaFolder aria-hidden="true" />
                            : <FileVisual path={entry.path} contentUrl={api.content(entry.path, true)} view={fileView} />}
                          {entry.type === 'directory' && (
                            <span className="grid-count" aria-hidden="true">{entry.children ?? 0}</span>
                          )}
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
                        </span>
                        {entry.type === 'directory' && (
                          <small className="grid-meta">{entry.children ?? 0} elementos</small>
                        )}
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
                                onClick={() => openMove(selected.includes(entry.path) ? selected : [entry.path])}
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
                            <>
                              <button
                                className="btn-action"
                                aria-label={'Mover ' + entry.name}
                                title="Mover"
                                onClick={() => openMove(selected.includes(entry.path) ? selected : [entry.path])}
                              >
                                <FaArrowsAlt size={12} />
                              </button>
                              <button
                                className="btn-action btn-delete"
                                aria-label={'Enviar ' + entry.name + ' a papelera'}
                                title={`Enviar ${entry.name} a papelera`}
                                disabled={saving}
                                onClick={() => {
                                  if (window.confirm(`¿Enviar la carpeta «${entry.name}» y todo su contenido a la papelera?`)) {
                                    action(
                                      () => api.trashFile(entry.path),
                                      `«${entry.name}» está en la papelera.`
                                    ).then(() => setSelected(old => old.filter(path => path !== entry.path)));
                                  }
                                }}
                              >
                                <FaTrash size={12} />
                              </button>
                            </>
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
              {recentlyAdded.length > 0 && (
                <section className="recent-strip" aria-label="Añadido recientemente">
                  <h2>Añadido recientemente</h2>
                  <div className="recent-grid">
                    {recentlyAdded.map(entry => (
                      <button
                        key={entry.path}
                        type="button"
                        className="grid-item recent-tile"
                        title={entry.path}
                        onClick={() => setSelected([entry.path])}
                      >
                        <span
                          className="grid-icon"
                          data-icon-type={entry.type === 'directory' ? 'folder' : classifyExtension(entry.name)}
                        >
                          {entry.type === 'directory'
                            ? <FaFolder aria-hidden="true" />
                            : <FileVisual path={entry.path} contentUrl={api.content(entry.path, true)} view="grid" />}
                        </span>
                        <span className="recent-details">
                          <span className="grid-name">{entry.name}</span>
                          <span className="recent-meta">{entry.type === 'directory' ? 'Carpeta' : bytes(entry.size)} · {date(entry.modifiedAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : view === 'trash' ? (
            <>
              <div className="toolbar files-toolbar">
                <button className="btn-back" onClick={() => { setView('files'); setRecentMode(false); }}>
                  <FaArrowLeft aria-hidden="true" /> Volver a archivos
                </button>
                <span className="toolbar-gap" />
                <button
                  className="btn-danger"
                  disabled={saving || trash.length === 0}
                  onClick={() => {
                    if (window.confirm(`¿Vaciar la papelera? Se eliminarán ${trash.length} elemento(s) de forma definitiva.`)) {
                      action(() => api.emptyTrash(), 'Papelera vaciada.');
                    }
                  }}
                >
                  <FaTrash aria-hidden="true" /> Vaciar papelera
                </button>
              </div>
              <section className="card file-table" aria-label="Archivos en papelera">
                <div className="table-head">
                  <div className="col-check" />
                  <div className="col-name">NOMBRE</div>
                  <div className="col-modified">MODIFICADO</div>
                  <div className="col-size">TAMAÑO</div>
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
                    <div className="col-modified">{date(item.deletedAt)}</div>
                    <div className="col-size" />
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
                      <button
                        className="btn-action btn-delete"
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(`¿Eliminar «${item.name}» definitivamente? No se puede deshacer.`)) {
                            action(() => api.permanentDelete(item.id), `«${item.name}» eliminado definitivamente.`);
                          }
                        }}
                        title="Eliminar definitivamente"
                        aria-label={'Eliminar definitivamente ' + item.name}
                      >
                        <FaTrash aria-hidden="true" />
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
          activity={activity}
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
      {multiSelection && (
        <MultiDetails
          entries={multiSelection}
          onDownload={() => {
            // Folders have no downloadable content: only files are requested.
            const files = multiSelection.filter(entry => entry.type === 'file');
            if (files.length > 0) download(files.map(entry => entry.path));
          }}
          onMove={() => openMove(selected)}
          onClear={() => setSelected([])}
        />
      )}
      {preview && <Preview entry={preview} onClose={() => setPreview(null)} />}

      {moving && (
        <dialog ref={moveDialogRef} className="move-dialog" aria-labelledby="move-title" onClose={() => setMoving(null)}>
          <header>
            <h2 id="move-title">Mover a otra carpeta</h2>
            <button type="button" onClick={() => setMoving(null)} aria-label="Cancelar">✕</button>
          </header>
          <p className="move-hint">
            {moving.length === 1
              ? `«${moving[0].path.split('/').at(-1)}»`
              : `${moving.length} elementos`} desde {folder || 'Inicio'}. Elige la carpeta de destino.
          </p>
          <div className="move-browser">
            <button
              type="button"
              className="move-up"
              onClick={() => setMoveTarget(moveParent)}
              disabled={moveTarget === ''}
              aria-label="Subir un nivel"
              title="Subir un nivel"
            >
              <FaArrowLeft aria-hidden="true" />
            </button>
            <nav className="move-destination" aria-label="Carpeta de destino">
              <button
                type="button"
                className={moveTarget === '' ? 'active' : ''}
                aria-current={moveTarget === '' ? 'location' : undefined}
                onClick={() => setMoveTarget('')}
              >
                Inicio
              </button>
              {moveCrumbs.map((name, index) => {
                const path = moveCrumbs.slice(0, index + 1).join('/');
                const current = index === moveCrumbs.length - 1;
                return (
                  <span key={path} className="move-crumb">
                    <span className="move-sep" aria-hidden="true">/</span>
                    <button
                      type="button"
                      className={current ? 'active' : ''}
                      aria-current={current ? 'location' : undefined}
                      onClick={() => setMoveTarget(path)}
                    >
                      {name}
                    </button>
                  </span>
                );
              })}
            </nav>
          </div>
          <div
            ref={moveListRef}
            className="move-list"
            role="group"
            aria-label="Subcarpetas de la carpeta de destino"
            aria-busy={moveLoading}
            tabIndex={-1}
          >
            {moveLoading && (
              <p className="move-state">
                <FaSpinner className="fa-spin" aria-hidden="true" /> Cargando carpetas…
              </p>
            )}
            {!moveLoading && moveBrowseError && (
              <p className="move-state error" role="alert">{moveBrowseError}</p>
            )}
            {!moveLoading && !moveBrowseError && moveFolders.length === 0 && (
              <p className="move-state">Esta carpeta no tiene subcarpetas. Puedes mover aquí mismo.</p>
            )}
            {!moveLoading && !moveBrowseError && moveFolders.map(entry => {
              const blocked = isMoveBlocked(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className="move-folder"
                  disabled={blocked}
                  aria-label={blocked ? `No puedes mover dentro de ${entry.name}` : `Abrir carpeta ${entry.name}`}
                  title={blocked ? 'No puedes mover una carpeta dentro de sí misma.' : `Abrir ${entry.name}`}
                  onClick={() => setMoveTarget(entry.path)}
                >
                  <FaFolder aria-hidden="true" />
                  <span className="move-name">{entry.name}</span>
                  {typeof entry.children === 'number' && entry.children > 0 && (
                    <span className="move-count" title={`${entry.children} elementos`}>{entry.children}</span>
                  )}
                </button>
              );
            })}
          </div>
          {error && <p className="move-error" role="alert">{error}</p>}
          <footer>
            <span className="move-summary" aria-live="polite">
              Se moverá a <strong>{moveTarget || 'Inicio'}</strong>
            </span>
            <div className="move-actions">
              <button type="button" className="btn" onClick={() => setMoving(null)}>Cancelar</button>
              <button type="button" className="btn primary" onClick={submitMove} disabled={saving || moveLoading || Boolean(moveBrowseError)}>
                {saving ? 'Moviendo…' : 'Mover aquí'}
              </button>
            </div>
          </footer>
        </dialog>
      )}
    </div>
  );
}

export default App;