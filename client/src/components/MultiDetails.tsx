import { FaDownload, FaFolder } from 'react-icons/fa';
import { api, type Entry } from '../api/api';
import { bytes } from '../workspace.mjs';
import { FileVisual } from './FileVisual';
import { kindLabel } from './Details';

export interface MultiDetailsProps {
  entries: Entry[];
  onDownload: () => void;
  onMove: () => void;
  onClear: () => void;
}

function plural(count: number, singular: string, many: string): string {
  return count === 1 ? singular : many;
}

// The panel keeps a summary of the selection instead of disappearing. Only
// real data is shown: a folder has no known size, so it is never summed and
// the summary says so explicitly.
export function MultiDetails({ entries, onDownload, onMove, onClear }: MultiDetailsProps) {
  const files = entries.filter(entry => entry.type === 'file');
  const folders = entries.filter(entry => entry.type === 'directory');
  const total = files.reduce((sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0), 0);
  const count = entries.length;

  const heading = folders.length === 0
    ? `${count} ${plural(count, 'archivo', 'archivos')} ${plural(count, 'seleccionado', 'seleccionados')}`
    : files.length === 0
      ? `${count} ${plural(count, 'carpeta', 'carpetas')} ${plural(count, 'seleccionada', 'seleccionadas')}`
      : `${count} elementos seleccionados`;

  const summary = folders.length === 0
    ? `${bytes(total)} en total`
    : files.length === 0
      ? `${count} ${plural(count, 'carpeta', 'carpetas')} · el tamaño de las carpetas no se calcula`
      : `${bytes(total)} en ${files.length} ${plural(files.length, 'archivo', 'archivos')} · ${folders.length} ${plural(folders.length, 'carpeta', 'carpetas')} sin tamaño`;

  const hint = files.length === 0
    ? 'Las carpetas no se descargan; «Mover» las incluye.'
    : folders.length === 0
      ? `Las acciones se aplican a los ${files.length} archivos.`
      : 'Descargar incluye solo los archivos; Mover incluye también las carpetas.';

  return (
    <aside className="inspector multi-inspector" aria-label="Resumen de la selección">
      <div className="inspector-head">
        <span className="inspector-label">Selección</span>
        <button
          type="button"
          className="inspector-close"
          onClick={onClear}
          aria-label="Cerrar el panel de selección"
          title="Cerrar el panel de selección (Esc)"
        >
          <span aria-hidden="true">esc</span>
        </button>
      </div>

      <div className="multi-summary">
        <span className="multi-count" aria-hidden="true">{count}</span>
        <h2>{heading}</h2>
        <p>{summary}</p>
      </div>

      <div className="multi-section">
        <h3 className="inspector-label multi-label">
          {folders.length === 0 ? 'Archivos seleccionados' : 'Elementos seleccionados'}
        </h3>
        <ul className="multi-list">
          {entries.map(entry => (
            <li key={entry.path}>
              {entry.type === 'directory' ? (
                <span className="multi-icon" data-icon-type="folder" aria-hidden="true">
                  <FaFolder />
                </span>
              ) : (
                <FileVisual
                  path={entry.path}
                  contentUrl={api.content(entry.path, true)}
                  view="list"
                  className="multi-icon"
                />
              )}
              <span className="multi-file">
                <span className="multi-name" title={entry.name}>{entry.name}</span>
                <span className="multi-size">
                  {entry.type === 'directory'
                    ? 'Carpeta · el tamaño no se calcula'
                    : `${kindLabel(entry)} · ${bytes(entry.size)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="multi-note">Selecciona un solo archivo para ver su vista previa y sus detalles.</p>
      </div>

      <div className="inspector-actions">
        <button
          type="button"
          className="inspector-btn primary"
          onClick={onDownload}
          disabled={files.length === 0}
          title={files.length === 0 ? 'Las carpetas no se pueden descargar' : 'Descargar los archivos seleccionados'}
        >
          <FaDownload aria-hidden="true" />
          Descargar seleccionados
        </button>
        <button
          type="button"
          className="inspector-btn"
          onClick={onMove}
          title="Mover la selección a otra carpeta"
        >
          <FaFolder aria-hidden="true" />
          Mover seleccionados
        </button>
        <p className="multi-hint">{hint}</p>
      </div>
    </aside>
  );
}
