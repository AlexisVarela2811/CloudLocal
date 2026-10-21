export function visibleServerUrls(advertised?: string[], currentOrigin?: string): string[];
export function bytes(value: number): string;
export function breadcrumbs(path: string): { name: string; path: string }[];
export function previewKind(name: string): 'image' | 'audio' | 'video' | 'pdf' | null;
export function exceedsLimit(size: number, limit?: number): boolean;
export function sortEntries<T extends { name: string; type: string }>(entries: T[]): T[];
