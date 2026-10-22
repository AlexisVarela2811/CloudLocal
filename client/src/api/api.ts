import axios from 'axios';

const http = axios.create({ baseURL: '/api' });
export interface Entry { name: string; path: string; type: 'file' | 'directory'; size: number; modifiedAt: string }
export interface TrashEntry { id: string; name: string; path: string; deletedAt: string }
export interface Session { configured: boolean; authenticated: boolean; localSetup: boolean }
export interface Status { storage: { total: number; free: number }; maxUploadBytes: number; urls: string[]; warning: string }
export interface Device { id: string; name: string; shares: { id: string; label: string }[]; online: boolean; lastSeen: string | null }
export interface SettingsInfo {
  folderPath: string | null;
  activeFolderPath: string;
  envOverride: boolean;
  needsRestart: boolean;
}
export interface Offer { id: string; deviceId: string; name: string; size: number; status: 'pending' | 'accepted' | 'delivered' | 'declined' | 'failed'; expiresAt: string }

export const api = {
  session: async () => (await http.get<Session>('/session')).data,
  setup: async (password: string) => (await http.post('/setup', { password })).data,
  login: async (password: string) => (await http.post('/login', { password })).data,
  logout: async () => (await http.post('/logout', {})).data,
  files: async (folder: string, q: string) => (await http.get<{ entries: Entry[] }>('/files', { params: { folder, q } })).data.entries,
  folder: async (folder: string, name: string) => (await http.post('/folders', { folder, name })).data,
  upload: async (folder: string, file: File, signal: AbortSignal, onProgress: (percent: number) => void) => {
    const data = new FormData();
    data.append('file', file);
    return (await http.post('/files/upload', data, {
      params: { folder },
      signal,
      onUploadProgress: event => { if (event.total) onProgress(Math.round(event.loaded / event.total * 100)); }
    })).data;
  },
  trashFile: async (path: string) => (await http.delete('/files', { params: { path } })).data,
  moveFile: async (from: string, to: string) => (await http.post<{ success: boolean; entry: Entry }>('/files/move', { from, to })).data,
  copy: async (from: string, to: string) => (await http.post<{ success: boolean; entry: Entry }>('/files/copy', { from, to })).data,
  paste: async (from: string, to: string, type: 'copy' | 'move') => (await http.post<{ success: boolean; count: number }>('/files/paste', { from, to, type })).data,
  permanentDelete: async (id: string) => (await http.post<{ success: boolean }>('/files/permanent', { id })).data,
  emptyTrash: async () => (await http.post<{ success: boolean }>('/trash/empty', {})).data,
  moveFolder: async (from: string, to: string) => (await http.post<{ success: boolean; entry: Entry }>('/files/moveFolder', { from, to })).data,
  restore: async (id: string) => (await http.post(`/trash/${encodeURIComponent(id)}/restore`, {})).data,
  trash: async () => (await http.get<{ entries: TrashEntry[] }>('/trash')).data.entries,
  status: async () => (await http.get<Status>('/status')).data,
  content: (path: string, inline = false) => `/api/files/content?path=${encodeURIComponent(path)}${inline ? '&inline=1' : ''}`,
  devices: async () => (await http.get<{ devices: Device[] }>('/devices/')).data.devices,
  offers: async () => (await http.get<{ offers: Offer[] }>('/devices/offers')).data.offers,
  pairCode: async () => (await http.post<{ code: string; expiresAt: string }>('/devices/pair-code', {})).data,
  revoke: async (id: string) => (await http.delete(`/devices/${encodeURIComponent(id)}`)).data,
  sharedEntries: async (id: string, share: string, path: string, signal: AbortSignal) => (await http.get<{ entries: Entry[] }>(`/devices/${encodeURIComponent(id)}/entries`, { params: { share, path }, signal, timeout: 35000 })).data.entries,
  sharedContent: (id: string, share: string, path: string) => `/api/devices/${encodeURIComponent(id)}/content?share=${encodeURIComponent(share)}&path=${encodeURIComponent(path)}`,
  sendOffer: async (id: string, path: string) => (await http.post<{ offer: Offer }>(`/devices/${encodeURIComponent(id)}/offers`, { path })).data.offer,
  settings: async () => (await http.get<SettingsInfo>('/settings')).data,
  saveFolder: async (folderPath: string) => (await http.put('/settings', { folderPath })).data,
  clearFolder: async () => (await http.delete('/settings')).data,
  shutdown: async () => (await http.post('/shutdown', {})).data,
};

export function failure(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') {
      const known: Record<string, string> = {
        'File or folder already exists': 'Ya existe un archivo o carpeta con ese nombre.',
        'Device unavailable': 'El equipo no está disponible. Comprueba que el acompañante esté conectado y vuelve a intentarlo.',
        'Device not found': 'Este equipo ya no está vinculado. Actualiza la lista.',
        'Share not found': 'La carpeta compartida ya no está disponible. Actualiza la lista.',
        'Device busy': 'El equipo está ocupado. Vuelve a intentarlo.',
        'Relay byte limit exceeded': 'El archivo supera el límite de transferencia del servidor.',
        'Too many codes': 'Se han generado demasiados códigos. Espera un minuto antes de volver a intentarlo.'
      };
      return known[message] || message;
    }
    if (error.code === 'ERR_CANCELED') return 'Cancelado';
  }
  return 'No se pudo completar la operación. Comprueba la conexión e inténtalo de nuevo.';
}
export function expired(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}
