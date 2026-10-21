/** Límite de entrada para no bloquear el navegador con textos enormes. */
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
