import { useCallback, useEffect, useRef } from 'react';
import { FaCloudUploadAlt } from 'react-icons/fa';
import { useDragUpload, isDragEventOverFiles } from '../hooks/useDragUpload';

interface DragAndDropProps {
  onFilesDropped: (files: File[], folderPath: string) => void;
  folderPath: string;
}

/**
 * Global drag-and-drop overlay component.
 * Shows a "Soltar archivos" overlay when files are dragged over the app.
 */
export function DragAndDrop({ onFilesDropped, folderPath }: DragAndDropProps) {
  const { dragState, onDragEnter, onDragLeave, onDrop } = useDragUpload();
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop(e);

    if (!isDragEventOverFiles(e)) return;

    const dt = e.dataTransfer;
    if (!dt) return;

    // Resolve files from DataTransfer, including directory trees
    const files = await resolveFiles(dt);
    if (files.length > 0) {
      onFilesDropped(files, folderPath);
    }
  }, [onDrop, onFilesDropped, folderPath]);

  // Global Escape key to dismiss
  useEffect(() => {
    if (dragState !== 'active') return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Move mouse off document to trigger dragleave
        document.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dragState]);

  if (dragState !== 'active') return null;

  return (
    <div
      ref={overlayRef}
      className="drag-overlay"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={handleFileDrop}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="drag-overlay-content" onClick={e => e.stopPropagation()}>
        <div className="drag-overlay-icon" aria-hidden="true">
          <FaCloudUploadAlt />
        </div>
        <p className="drag-overlay-text">Soltar archivos para subir a {folderPath || 'inicio'}</p>
        <p className="drag-overlay-sub">Se guardarán en la carpeta actual</p>
      </div>
    </div>
  );
}

/**
 * Resolve File objects from DataTransfer, supporting:
 * - Simple file list
 * - Directory trees via webkitGetAsEntry
 */
async function resolveFiles(dt: DataTransfer): Promise<File[]> {
  const files: File[] = [];

  // Try directory tree walk first (webkitGetAsEntry)
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < dt.items?.length; i++) {
    const entry = dt.items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>(resolve => {
          (entry as FileSystemFileEntry).file(f => resolve(f));
        });
        files.push(file);
      } else if (entry.isDirectory) {
        const dirFiles = await walkDirectory(entry as FileSystemDirectoryEntry);
        files.push(...dirFiles);
      }
    }
  } else {
    // Fall back to regular files
    for (let i = 0; i < dt.files?.length; i++) {
      files.push(dt.files[i]);
    }
  }

  return files;
}

/**
 * Recursively walk a directory entry, preserving path structure.
 */
async function walkDirectory(dir: FileSystemDirectoryEntry, pathPrefix = ''): Promise<File[]> {
  const files: File[] = [];
  const reader = dir.createReader();

  const readEntries = (): Promise<FileSystemEntry[]> =>
    new Promise(resolve => {
      reader.readEntries(entries => resolve(entries), () => resolve([]));
    });

  let remaining = true;
  while (remaining) {
    const dirEntries = await readEntries();
    remaining = dirEntries.length > 0;

    for (const entry of dirEntries) {
      const entryPath = pathPrefix
        ? `${pathPrefix}/${entry.name}`
        : entry.name;

      if (entry.isFile) {
        const file = await new Promise<File>(resolve => {
          (entry as FileSystemFileEntry).file(f => resolve(f));
        });
        files.push(new File([file], entryPath, { type: file.type }));
      } else if (entry.isDirectory) {
        const subFiles = await walkDirectory(entry as FileSystemDirectoryEntry, entryPath);
        files.push(...subFiles);
      }
    }
  }

  return files;
}