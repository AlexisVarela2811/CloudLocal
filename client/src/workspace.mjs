// Only advertise same-origin HTTP links with private IPv4 hosts. Never suggest a
// loopback URL to a different computer, even if the server reports one.
export function visibleServerUrls(advertised = [], currentOrigin = '') {
  const normalize = value => {
    try {
      const url = new URL(value);
      const parts = url.hostname.split('.').map(Number);
      const privateAddress = parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
        (parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
          parts[0] === 192 && parts[1] === 168 || parts[0] === 169 && parts[1] === 254);
      const rootOrigin = value === url.origin || value === `${url.origin}:80`;
      return url.protocol === 'http:' && privateAddress && !url.username && !url.password &&
        url.pathname === '/' && !url.search && !url.hash && rootOrigin ? url.origin : null;
    } catch { return null; }
  };
  return [...new Set([...advertised, currentOrigin].map(normalize).filter(value => value !== null))];
}
export function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit++; } while (amount >= 1024 && unit < units.length - 1);
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}
export function breadcrumbs(path) {
  const parts = path ? path.split('/') : [];
  return [{ name: 'Inicio', path: '' }, ...parts.map((name, index) => ({
    name, path: parts.slice(0, index + 1).join('/')
  }))];
}
export function previewKind(name) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(extension)) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  return null;
}
export function exceedsLimit(size, limit) {
  return Number.isFinite(limit) && limit > 0 && size > limit;
}
export function sortEntries(entries) {
  return [...entries].sort((a, b) => (a.type === 'directory' ? 0 : 1) -
    (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }));
}
