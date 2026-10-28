/**
 * Hook for the SSE file-events stream.
 * Connects to GET /api/events, fires a callback for each event.
 * Automatically reconnects on disconnect.
 */
import { useEffect, useRef } from 'react';

type SseEventListener = (type: string, data: unknown) => void;

export function useSSE(listener: SseEventListener) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    let aborted = false;

    function connect() {
      if (aborted) return;

      // Reconstruct the base URL from window.location
      const baseUrl = `${window.location.protocol}//${window.location.host}`;

      const evtSource = new EventSource(`${baseUrl}/api/events`, { withCredentials: true });

      evtSource.addEventListener('upload', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('upload', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('trash', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('trash', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('restore', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('restore', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('move', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('move', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('copy', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('copy', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('paste', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('paste', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('folder', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('folder', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('empty-trash', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('empty-trash', JSON.parse(e.data)); } catch { /* ignore */ }
      });
      evtSource.addEventListener('permanent-delete', (e: MessageEvent) => {
        if (aborted) return;
        try { listenerRef.current('permanent-delete', JSON.parse(e.data)); } catch { /* ignore */ }
      });

      evtSource.onerror = () => {
        if (aborted) {
          evtSource.close();
          return;
        }
        // EventSource auto-reconnects; don't spam logs.
        evtSource.close();
      };
    }

    connect();

    return () => {
      aborted = true;
    };
  }, []);
}