// ── fileVisuals.mjs ──
// Extension classification returning consistent canonical categories.
// Categories match what iconMap and CSS data-icon-type expect.

const EXT_MAP = new Map();

function register(extensions, category) {
  for (const ext of extensions) EXT_MAP.set(ext, category);
}

register(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'tiff', 'tif', 'ico'], 'image');
register(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'wmv', 'flv'], 'video');
register(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'aiff', 'amr'], 'audio');
register(['pdf'], 'pdf');
register(['doc', 'docx'], 'word');
register(['xls', 'xlsx', 'csv'], 'excel');
register(['ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'ppsm'], 'powerpoint');
register(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'sitx'], 'archive');
register(['txt', 'md', 'rtf', 'log', 'ini', 'cfg', 'conf', 'toml', 'yaml', 'yml', 'json'], 'text');
register([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'hpp',
  'java', 'kt', 'swift', 'php', 'cs', 'vb', 'lua', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'sql', 'r', 'dart', 'scala', 'clj', 'hs', 'erl', 'ex', 'exs',
  'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl',
], 'code');

// Freeze the Map after initialisation so callers cannot mutate it.
Object.freeze(EXT_MAP);

/**
 * Classify a filename by extension.
 * Returns a canonical category string (image, video, audio, pdf, word,
 * excel, powerpoint, archive, text, code, unknown).
 * Not for directories — the caller checks entry.type.
 */
export function classifyExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_MAP.get(ext) ?? 'unknown';
}

export { EXT_MAP };