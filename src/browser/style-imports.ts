import { sourceURL, type DownloadedSource } from './source-files';
export type StyleImports = Readonly<Record<string, DownloadedSource>>;
export interface StyleCompileContext { readonly sourceURL?: string; readonly imports?: StyleImports; readonly importURLs?: readonly string[] }
export function decodeStyleImports(input: unknown, directorySnapshot = false): StyleImports {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid style dependencies.');
  const entries = Object.entries(input);
  if (entries.length > (directorySnapshot ? 256 : 32)) throw new Error('Too many style dependencies.');
  let bytes = 0;
  const result: Record<string, DownloadedSource> = Object.create(null);
  for (const [key, raw] of entries) {
    const item = raw as DownloadedSource;
    if (!item || typeof item.url !== 'string' || typeof item.source !== 'string' || item.source.includes('\0')) throw new Error('Invalid style dependency.');
    bytes += new TextEncoder().encode(item.source).length;
    if (bytes > (directorySnapshot ? 8 : 2) * 1024 * 1024) throw new Error('Style dependencies exceed the size limit.');
    result[sourceURL(key)] = { url: sourceURL(item.url), source: item.source };
  }
  return result;
}
