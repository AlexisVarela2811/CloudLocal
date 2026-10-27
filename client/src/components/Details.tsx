import { FaDownload, FaEye, FaFolderOpen, FaPen, FaTrash } from 'react-icons/fa';
import { api, type Entry } from '../api/api';
import { classifyExtension } from './fileVisuals.mjs';
import { bytes } from '../workspace.mjs';
import { FileVisual } from './FileVisual';

export interface ActivityEvent {
  type: string;
  path: string;
  at: number;
}

export interface DetailsProps {
  entry: Entry;
  activity: ActivityEvent[];
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const ACTIVITY_LABELS: Record<string, string> = {
  upload: 'Archivo subido',
  folder: 'Carpeta creada',
  trash: 'Enviado a la papelera',
  restore: 'Restaurado',
  move: 'Movido',
  copy: 'Copiado',
  paste: 'Pegado',
  'permanent-delete': 'Eliminado definitivamente',
  'empty-trash': 'Papelera vaciada',
};

function formatDate(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '—';
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

function kindLabel(entry: Entry): string {
  if (entry.type === 'directory') return 'Carpeta';
  const dot = entry.name.lastIndexOf('.');
  const ext = dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : '';
  return ext ? `Archivo ${ext}` : 'Archivo';
}

function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? 'Cambio';
}

function activityClock(at: number): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return '—';
  return new Intl.DateTimeFormat('es', { timeStyle: 'medium' }).format(time);
}

// Keep events about the entry itself, its contents, or its parent folder.
function activityFor(activity: ActivityEvent[], entryPath: string): ActivityEvent[] {
  const parent = folderOf(entryPath);
  return activity.filter(event => {
    if (!event.path) return false;
    if (event.path === entryPath) return true;
    if (event.path.startsWith(`${entryPath}/`)) return true;
    return folderOf(event.path) === parent;
  });
}

export function Details({ entry, activity, onOpen, onDownload, onRename, onDelete }: DetailsProps) {
  const isFolder = entry.type === 'directory';
  const kind = isFolder ? 'folder' : classifyExtension(entry.name);
  const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toUpperCase() : '';
  const previewable = kind === 'image' || kind === 'video' || kind === 'audio';
  const recentActivity = activityFor(activity, entry.path);

  return (
    <aside className="inspector" aria-label="Detalle del elemento seleccionado">
      <div className="inspector-head">
        <span className="inspector-label">Detalle</span>
      </div>

      <div className="inspector-preview">
        {isFolder ? (
          <span className="inspector-folder" aria-hidden="true">
            <FaFolderOpen />
          </span>
        ) : previewable ? (
          <FileVisual
            path={entry.path}
            contentUrl={api.content(entry.path)}
            view="grid"
            className="inspector-visual"
          />
        ) : (
          <span className={`inspector-plate plate-${kind}`} aria-hidden="true">
            {extension || 'FILE'}
          </span>
        )}
      </div>

      <div className="inspector-body">
        <p className="inspector-name" title={entry.name}>{entry.name}</p>
        <p className="inspector-path">/{entry.path}</p>

        <dl className="inspector-meta">
          <dt>Tipo</dt>
          <dd>{kindLabel(entry)}</dd>
          <dt>Tamaño</dt>
          <dd>{isFolder ? '—' : bytes(entry.size)}</dd>
          <dt>Modificado</dt>
          <dd>{formatDate(entry.modifiedAt)}</dd>
          <dt>Ubicación</dt>
          <dd>{entry.path.includes('/') ? '/' + entry.path.slice(0, entry.path.lastIndexOf('/')) : 'Inicio'}</dd>
        </dl>

        <div className="inspector-activity">
          <h3 className="inspector-activity-title">Actividad</h3>
          {recentActivity.length === 0 ? (
            <p className="inspector-activity-empty">Sin actividad reciente</p>
          ) : (
            <ul className="inspector-activity-list">
              {recentActivity.map((event, index) => (
                <li key={`${event.at}-${index}`} className="inspector-activity-item">
                  <span className="inspector-activity-time">{activityClock(event.at)}</span>
                  <span className="inspector-activity-text">
                    {activityLabel(event.type)}
                    {event.path.split('/').at(-1) && (
                      <span className="inspector-activity-name"> · {event.path.split('/').at(-1)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="inspector-actions">
        <button type="button" className="inspector-btn primary" onClick={onOpen}>
          <FaEye aria-hidden="true" />
          {isFolder ? 'Abrir carpeta' : 'Vista previa'}
        </button>
        <div className="inspector-row">
          <button type="button" className="inspector-btn" onClick={onRename}>
            <FaPen aria-hidden="true" />
            Renombrar
          </button>
          <button type="button" className="inspector-btn" onClick={onDownload} disabled={isFolder}>
            <FaDownload aria-hidden="true" />
            Descargar
          </button>
        </div>
        <button type="button" className="inspector-btn danger" onClick={onDelete}>
          <FaTrash aria-hidden="true" />
          Enviar a la Papelera
        </button>
      </div>
    </aside>
  );
}
