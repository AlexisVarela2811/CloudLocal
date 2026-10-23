import { useEffect, useRef, useState, type ChangeEvent, useCallback } from 'react';
import { api, expired, failure } from '../api/api';
import { bytes, exceedsLimit } from '../workspace.mjs';

type UploadState = 'waiting' | 'uploading' | 'paused' | 'reconnecting' | 'error' | 'done' | 'canceling' | 'cancelled';

interface QueueItem {
  id: number;
  file: File;
  name: string;
  state: UploadState;
  progress: number;
  error?: string;
  abortController?: AbortController;
}

interface UploadQueueProps {
  folder: string;
  limit?: number;
  onChange: () => void;
  onExpired: () => void;
}

const MAX_RECONNECT = 3;

function stateLabel(s: UploadState): string {
  switch (s) {
    case 'waiting': return 'En espera';
    case 'uploading': return 'Subiendo';
    case 'paused': return 'Pausado';
    case 'reconnecting': return 'Reconectando…';
    case 'error': return 'Error';
    case 'done': return 'Subido';
    case 'canceling': return 'Cancelando…';
    case 'cancelled': return 'Cancelado';
    default: return s;
  }
}

function stateBorderColor(s: UploadState): string {
  switch (s) {
    case 'uploading': return 'var(--accent)';
    case 'paused': return 'var(--state-paused)';
    case 'error': return 'var(--danger)';
    case 'done': return 'var(--state-done)';
    case 'reconnecting': return 'var(--accent)';
    case 'canceling': return 'var(--danger)';
    default: return 'transparent';
  }
}

function stateBarColor(s: UploadState): string {
  switch (s) {
    case 'uploading': return 'var(--accent)';
    case 'paused': return 'var(--state-paused)';
    case 'error': return 'var(--danger)';
    case 'done': return 'var(--state-done)';
    case 'reconnecting': return 'var(--accent)';
    default: return 'var(--accent)';
  }
}

export function UploadQueue({ folder, limit, onChange, onExpired }: UploadQueueProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const busyRef = useRef(false);
  const cancelAllRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => () => { cancelAllRef.current = true; controllerRef.current?.abort(); }, []);

  const updateItem = useCallback((id: number, patch: Partial<Pick<QueueItem, 'state' | 'progress' | 'error'>>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const abortItem = useCallback((id: number) => {
    const controller = items.find(i => i.id === id)?.abortController;
    if (controller) controller.abort();
  }, [items]);

  async function select(event: ChangeEvent<HTMLInputElement>) {
    if (busyRef.current) return;
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    cancelAllRef.current = false;
    busyRef.current = true;
    const batch = files.map(file => ({ file, id: ++nextId.current }));
    setItems(batch.map(({ file, id }) => ({ id, file, name: file.name, state: 'waiting' as UploadState, progress: 0 })));
    try {
      await processBatch(batch);
    } finally { busyRef.current = false; }
  }

  async function processBatch(batch: { file: File; id: number }[]) {
    if (runningRef.current) return;
    runningRef.current = true;

    for (const { file, id } of batch) {
      if (cancelAllRef.current) { updateItem(id, { state: 'cancelled' }); continue; }

      const item = items.find(i => i.id === id);
      if (item?.state === 'paused' || item?.state === 'error') continue;

      if (exceedsLimit(file.size, limit)) { updateItem(id, { state: 'error', error: `Supera el límite de ${bytes(limit!)}` }); continue; }

      let attempt = 0;
      let uploaded = false;
      while (!uploaded && attempt < MAX_RECONNECT) {
        if (cancelAllRef.current) { updateItem(id, { state: 'cancelled' }); break; }
        const current = items.find(i => i.id === id);
        if (current?.state === 'paused') { updateItem(id, { state: 'paused' }); break; }

        const active = new AbortController();
        controllerRef.current = active;
        updateItem(id, { state: 'uploading' });

        try {
          await api.upload(folder, file, active.signal, (percent: number) => updateItem(id, { progress: percent }));
          updateItem(id, { state: 'done', progress: 100 });
          onChange();
          uploaded = true;
        } catch (cause: unknown) {
          if (expired(cause)) { updateItem(id, { state: 'error', error: 'Sesión caducada; vuelve a entrar' }); cancelAllRef.current = true; onExpired(); uploaded = true; }
          else if (active.signal.aborted) { updateItem(id, { state: 'cancelled' }); uploaded = true; }
          else if (attempt < MAX_RECONNECT - 1) {
            attempt++;
            updateItem(id, { state: 'reconnecting', error: `Intento ${attempt}/${MAX_RECONNECT - 1}` });
            await new Promise(r => setTimeout(r, 2000 * attempt));
          } else {
            updateItem(id, { state: 'error', error: failure(cause) });
            uploaded = true;
          }
        }
      }
    }
    runningRef.current = false;
  }

  function pauseItem(id: number) {
    abortItem(id);
    updateItem(id, { state: 'paused' });
  }

  function resumeItem(id: number) {
    updateItem(id, { state: 'waiting' });
    // Restart batch processing
    const item = items.find(i => i.id === id);
    if (item) processBatch([{ file: item.file, id }]);
  }

  function retryItem(id: number) {
    updateItem(id, { state: 'waiting', error: undefined });
    const item = items.find(i => i.id === id);
    if (item) processBatch([{ file: item.file, id }]);
  }

  function cancelItem(id: number) {
    updateItem(id, { state: 'canceling' });
    abortItem(id);
    updateItem(id, { state: 'cancelled' });
  }

  const hasRunning = items.some(i => i.state === 'uploading' || i.state === 'reconnecting');

  return (
    <section className="upload-box">
      <div className="upload-heading">
        <div>
          <strong>Subir archivos</strong>
          <p className="muted">
            Se guardan en esta carpeta, uno por uno.{' '}
            {limit ? `Máximo por archivo: ${bytes(limit)}.` : 'Consulta el límite en el servidor.'}
          </p>
        </div>
        <div className="upload-heading-actions">
          {hasRunning && (
            <button type="button" className="btn-danger-outline btn-sm" onClick={() => { cancelAllRef.current = true; controllerRef.current?.abort(); }}>
              Cancelar todo
            </button>
          )}
          <label className={`upload-btn ${hasRunning ? 'disabled' : ''}`}>
            <span>Elegir archivos</span>
            <input type="file" multiple onChange={select} disabled={hasRunning} aria-label="Elegir archivos para subir" />
          </label>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="upload-results" aria-live="polite">
          {items.map(item => (
            <li
              key={item.id}
              className="upload-item"
              style={{ borderLeftColor: stateBorderColor(item.state) }}
            >
              <div className="upload-item-info">
                <span className="upload-name" title={item.name}>{item.name}</span>
                <span className="upload-status">{stateLabel(item.state)}</span>
              </div>

              {item.state === 'uploading' && (
                <span className="upload-progress-text">{item.progress}%</span>
              )}
              {item.state === 'reconnecting' && (
                <span className="upload-progress-text">{item.error}</span>
              )}
              {item.state === 'paused' && (
                <span className="upload-progress-text">0%</span>
              )}

              {item.state !== 'waiting' && item.state !== 'canceling' && (
                <div className="upload-progress-bar">
                  <div
                    className="upload-progress-bar-fill"
                    style={{
                      width: `${item.progress}%`,
                      height: '100%',
                      backgroundColor: stateBarColor(item.state),
                      transition: 'width .3s ease',
                    }}
                  />
                </div>
              )}

              <div className="upload-actions">
                {item.state === 'uploading' && (
                  <button
                    type="button"
                    className="btn-action"
                    onClick={() => pauseItem(item.id)}
                    title="Pausar"
                  >
                    Pausar
                  </button>
                )}
                {item.state === 'paused' && (
                  <button
                    type="button"
                    className="btn-action"
                    onClick={() => resumeItem(item.id)}
                    title="Reanudar"
                  >
                    Reanudar
                  </button>
                )}
                {(item.state === 'error' || item.state === 'cancelled') && (
                  <button
                    type="button"
                    className="btn-action"
                    onClick={() => retryItem(item.id)}
                    title="Reintentar"
                  >
                    Reintentar
                  </button>
                )}
                {item.state !== 'waiting' && item.state !== 'done' && item.state !== 'canceling' && (
                  <button
                    type="button"
                    className="btn-action btn-delete"
                    onClick={() => cancelItem(item.id)}
                    title="Cancelar"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {item.error && item.state === 'error' && (
                <span className="upload-error" title={item.error}>{item.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}