// TypeScript declarations for fileVisuals.mjs

export const EXT_MAP: Map<string, string>;

/**
 * Classify a filename by extension.
 * Returns a canonical category: image, video, audio, pdf, word, excel,
 * powerpoint, archive, text, code, or unknown (for unrecognized extensions).
 * Directories must not be passed here — the caller checks entry.type.
 */
export function classifyExtension(name: string): string;