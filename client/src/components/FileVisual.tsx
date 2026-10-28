// ── FileVisual.tsx ──
// Lightweight per-extension file icons and thumbnails, Windows-Explorer style.
//
// - Non-media files: instant category icon, never a spinner.
// - Images: native <img src=contentUrl> loaded on visibility, no fetch/FileReader.
// - Videos: bounded metadata + seek + canvas frame extraction.
// - At most MAX_CONCURRENT media loads run at once (shared queue).
// - Lazy via IntersectionObserver; aborted on unmount or path change.
// - Every terminal path (success, error, timeout, abort) releases its queue slot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaFilePdf, FaFileImage, FaFileVideo, FaFileAudio,
  FaFileWord, FaFileExcel, FaFilePowerpoint,
  FaFileArchive, FaFileCode, FaFileAlt, FaFile,
  FaSpinner,
} from 'react-icons/fa';
import { classifyExtension } from './fileVisuals.mjs';
import { createQueue } from './thumbnailQueue.mjs';

// ── Limits ──
const MAX_CONCURRENT = 3;
const THUMBNAIL_TIMEOUT_MS = 5_000;
const CANVAS_SIZE = 256;

// ── Icon map ──
const ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  pdf: FaFilePdf,
  image: FaFileImage,
  video: FaFileVideo,
  audio: FaFileAudio,
  word: FaFileWord,
  excel: FaFileExcel,
  powerpoint: FaFilePowerpoint,
  archive: FaFileArchive,
  code: FaFileCode,
  text: FaFileAlt,
  unknown: FaFile,
};

// ── Internal state shape ──
type Kind = 'icon' | 'loading' | 'image' | 'video-thumb' | 'fallback';

interface State {
  kind: Kind;
  src?: string;
  category?: string;
}

/** Receives the terminal state of one media load, or null when it was aborted. */
type Settle = (next: State | null) => void;

// ── Props ──
export interface FileVisualProps {
  path: string;
  contentUrl: string;
  view: 'list' | 'grid';
  className?: string;
  onLoaded?: () => void;
}

// ── Queue shared by every FileVisual instance ──
const queue = createQueue(MAX_CONCURRENT);

// ── Component ──
export function FileVisual({ path, contentUrl, view, className, onLoaded }: FileVisualProps) {
  const category = useMemo(() => classifyExtension(path), [path]);
  const isMedia = category === 'image' || category === 'video';

  // Only media starts as loading; everything else shows its icon immediately.
  const [state, setState] = useState<State>(() => ({
    kind: isMedia ? 'loading' : 'icon',
    category,
  }));

  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const mountedRef = useRef(true);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const loadedRef = useRef(false);
  const onLoadedRef = useRef(onLoaded);

  onLoadedRef.current = onLoaded;

  /** Drop the in-flight load, freeing its queue slot. */
  const stop = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  // ── Load one media thumbnail through the shared queue ──
  const loadThumbnail = useCallback((cat: string, url: string) => {
    if (loadedRef.current || !mountedRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    cancelRef.current = queue.enqueue((release) => {
      let settled = false;

      const settle: Settle = (next) => {
        if (settled) return;
        settled = true;

        if (next && mountedRef.current && !controller.signal.aborted) {
          setState(next);
          if (next.kind === 'image' || next.kind === 'video-thumb') {
            loadedRef.current = true;
            onLoadedRef.current?.();
          }
        }
        release();
      };

      if (controller.signal.aborted || !mountedRef.current) {
        settle(null);
        return;
      }

      if (cat === 'image') {
        loadImageThumbnail(controller.signal, url, settle);
      } else {
        loadVideoFrame(controller.signal, url, cat, settle);
      }
    }).cancel;
  }, []);

  // ── Reset on mount, path change and unmount ──
  useEffect(() => {
    mountedRef.current = true;
    loadedRef.current = false;
    setState({ kind: isMedia ? 'loading' : 'icon', category });

    return () => {
      mountedRef.current = false;
      loadedRef.current = false;
      stop();
    };
  }, [path, contentUrl, isMedia, category, stop]);

  // ── Start loading once the row/item is visible ──
  useEffect(() => {
    if (!isMedia || state.kind !== 'loading' || loadedRef.current) return;
    const node = wrapperRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!mountedRef.current) return;
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        observerRef.current = null;
        loadThumbnail(category, contentUrl);
      },
      { rootMargin: '200px', threshold: 0.01 },
    );

    observer.observe(node);
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [isMedia, category, contentUrl, state.kind, loadThumbnail]);

  // ── Render ──
  const Icon = ICON_MAP[state.category ?? category] ?? FaFile;
  let inner: React.ReactNode;

  switch (state.kind) {
    case 'icon':
    case 'fallback':
      inner = <Icon aria-hidden="true" />;
      break;

    case 'loading':
      inner = <FaSpinner className="fa-spin" size={view === 'grid' ? 24 : 14} />;
      break;

    case 'image':
    case 'video-thumb':
      inner = (
        <img
          src={state.src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setState((s) => ({ ...s, kind: 'fallback', src: undefined }))}
        />
      );
      break;
  }

  return (
    <span
      ref={wrapperRef}
      className={className}
      data-category={category}
      aria-hidden="true"
    >
      {inner}
    </span>
  );
}

// ── Native <img> thumbnail (no fetch, no FileReader) ──
function loadImageThumbnail(signal: AbortSignal, url: string, settle: Settle): void {
  const img = new Image();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const done = (next: State | null) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    signal.removeEventListener('abort', onAbort);
    img.onload = null;
    img.onerror = null;
    img.src = '';
    settle(next);
  };

  function onAbort() {
    done(null);
  }

  signal.addEventListener('abort', onAbort);
  timer = setTimeout(() => done({ kind: 'fallback' }), THUMBNAIL_TIMEOUT_MS);
  img.onload = () => done({ kind: 'image', src: url });
  img.onerror = () => done({ kind: 'fallback' });
  img.src = url;
}

// ── Video frame extraction ──
function loadVideoFrame(
  signal: AbortSignal,
  url: string,
  category: string,
  settle: Settle,
): void {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.style.cssText =
    'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    signal.removeEventListener('abort', onAbort);
    video.onloadedmetadata = null;
    video.onseeked = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  };

  function finish(next: State | null) {
    cleanup();
    settle(next);
  }

  function onAbort() {
    finish(null);
  }

  signal.addEventListener('abort', onAbort);
  timer = setTimeout(() => finish({ kind: 'fallback', category }), THUMBNAIL_TIMEOUT_MS);

  video.onerror = () => finish({ kind: 'fallback', category });

  video.onloadedmetadata = () => {
    const duration = video.duration;
    let seekTime = 1;
    if (Number.isFinite(duration) && duration > 0) {
      seekTime = duration < 1 ? duration / 2 : Math.min(2, duration * 0.25);
      seekTime = Math.min(seekTime, duration);
    }

    video.onseeked = () => finish(extractFrame(video, category));

    try {
      video.currentTime = seekTime;
    } catch {
      finish({ kind: 'fallback', category });
    }
  };

  video.src = url;
  video.load();
}

/** Draw the current video frame onto a square canvas and return it as a JPEG data URL. */
function extractFrame(video: HTMLVideoElement, category: string): State {
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return { kind: 'fallback', category };

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { kind: 'fallback', category };

    const size = Math.min(width, height);
    const sx = (width - size) / 2;
    const sy = (height - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    return { kind: 'video-thumb', src: canvas.toDataURL('image/jpeg', 0.7), category };
  } catch {
    return { kind: 'fallback', category };
  }
}
