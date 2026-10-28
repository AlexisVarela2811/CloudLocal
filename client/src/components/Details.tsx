import { FaDownload, FaEye, FaFolderOpen, FaPen, FaTrash } from 'react-icons/fa';
import { api, type Entry } from '../api/api';
import { bytes } from '../workspace.mjs';
import { FileVisual } from './FileVisual';

export interface DetailsProps {
  entry: Entry;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}

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

export function Details({ entry, onOpen, onDownload, onRename, onDelete }: DetailsProps) {
  const isFolder = entry.type === 'directory';

  return (
    <aside className="inspector" aria-label="Detalle del elemento seleccionado">
      <div className="inspector-head">
        <span className="inspector-label">Detalle</span>
      </div>

      <div className={`inspector-preview${isFolder ? ' is-folder' : ''}`}>
        {isFolder ? (
          <span className="inspector-folder" aria-hidden="true">
            <FaFolderOpen />
          </span>
        ) : (
          <FileVisual
            path={entry.path}
            contentUrl={api.content(entry.path)}
            view="grid"
            className="inspector-visual"
          />
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
