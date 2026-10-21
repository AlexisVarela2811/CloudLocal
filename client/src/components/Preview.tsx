import { useEffect, useRef, useState } from 'react';
import { api, type Entry } from '../api/api';
import { previewKind } from '../workspace.mjs';

export function Preview({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const kind = previewKind(entry.name);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  // Keyboard: Escape is native to <dialog>; add explicit handler too
  useEffect(() => {
    const dialog = ref.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog?.open) { e.preventDefault(); onClose(); }
    };
    dialog?.addEventListener('keydown', handler);
    return () => { dialog?.removeEventListener('keydown', handler); };
  }, [onClose]);

  return (
    <dialog ref={ref} className="preview-panel" aria-label={`Vista previa de ${entry.name}`}
      onCancel={onClose}
      onClick={event => { if (event.target === ref.current) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
    >
      <header>
        <strong>{entry.name}</strong>
        <button autoFocus onClick={onClose}>Cerrar vista previa</button>
      </header>

      {kind === 'image' ? (
        <div
          className="image-fullscreen-backdrop"
          onClick={onClose}
          style={{
            position: 'relative',
            display: 'block',
            background: 'rgba(0, 0, 0, 0.55)',
            borderRadius: 'var(--radius)',
            padding: '1rem 0',
            overflow: 'hidden',
          }}
        >
          {!imgLoaded && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '40vh',
                color: 'var(--muted)',
                fontSize: '.85rem',
              }}
            >
              Cargando imagen…
            </div>
          )}
          <img
            alt={entry.name}
            src={api.content(entry.path, true)}
            onLoad={() => setImgLoaded(true)}
            style={{
              display: imgLoaded ? 'block' : 'none',
              maxWidth: '95vw',
              maxHeight: '80vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: 'var(--radius-sm)',
              margin: '0 auto',
              cursor: 'zoom-out',
            }}
          />
        </div>
      ) : kind === 'audio' ? (
        <audio controls src={api.content(entry.path, true)} />
      ) : (
        <video controls src={api.content(entry.path, true)} />
      )}
    </dialog>
  );
}
