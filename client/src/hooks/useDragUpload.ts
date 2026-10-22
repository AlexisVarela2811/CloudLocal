import { useCallback, useRef, useState } from 'react';

export type DragState = 'idle' | 'active';

export interface UseDragUploadResult {
  dragState: DragState;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function useDragUpload(): UseDragUploadResult {
  const [dragState, setDragState] = useState<DragState>('idle');
  const dragCounterRef = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setDragState('active');
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only consider it truly leaving if we're not moving to a child element
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget && e.currentTarget instanceof HTMLElement) {
      try {
        if (e.currentTarget.contains(relatedTarget)) return;
      } catch { /* ignore */ }
    }
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragState('idle');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragState('idle');
  }, []);

  return { dragState, onDragEnter, onDragLeave, onDrop };
}

export function isDragEventOverFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types || [];
  return types.includes('Files');
}