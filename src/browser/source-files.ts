import { decodeStyleImports, type StyleImports } from './style-imports';
export interface SourceFolderSnapshot {
  readonly error?: string;
  readonly directories: readonly string[];
  readonly imports?: StyleImports;
  readonly files: readonly { readonly id: string; readonly name: string; readonly source: string; readonly dependencyRevision?: string; readonly sourceBaseURL?: string }[];
}
export interface SourceFolderPort {
  folders(action: 'list' | 'add' | 'remove', path?: string): Promise<SourceFolderSnapshot>;
}
export function decodeSourceFolders(input: unknown): SourceFolderSnapshot {
  const fail = (): never => { throw new Error('Invalid folder list'); };
  if (!input || typeof input !== 'object') return fail();
  const value = input as SourceFolderSnapshot;
  if (!Array.isArray(value.directories) || value.directories.length > 16 || value.directories.some(path => typeof path !== 'string' || path.length > 4096)
    || !Array.isArray(value.files) || value.files.length > 256) return fail();
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 2048)) return fail();
  let bytes = 0;
  const ids = new Set<string>();
  for (const file of value.files) {
    if (!file || typeof file.id !== 'string' || !/^folder_[a-f0-9]{64}$/.test(file.id) || ids.has(file.id) || typeof file.name !== 'string' || typeof file.source !== 'string') return fail();
    if (file.dependencyRevision !== undefined && (typeof file.dependencyRevision !== 'string' || !/^[a-f0-9]{64}$/.test(file.dependencyRevision))) return fail();
    if (file.sourceBaseURL !== undefined && (typeof file.sourceBaseURL !== 'string' || new URL(sourceURL(file.sourceBaseURL)).hostname !== 'derpbird-source.invalid')) return fail();
    ids.add(file.id);
    bytes += new TextEncoder().encode(file.source).length;
    if (bytes > 2 * 1024 * 1024) return fail();
  }
  return { ...value, ...(value.imports === undefined ? {} : { imports: decodeStyleImports(value.imports, true) }) };
}
export function exportSource(name: string, source: string, suffix: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120) || 'source'}${suffix}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function readSourceFile(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  if (source.includes('\0')) throw new Error('Choose a UTF-8 text file.');
  return source;
}

export interface DownloadedSource { readonly url: string; readonly source: string }
export function sourceURL(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || input.length > 8192) throw new Error('Enter an HTTP(S) URL without credentials.');
  return url.href;
}
export function decodeDownloadedSource(input: unknown): DownloadedSource {
  if (!input || typeof input !== 'object') throw new Error('Invalid download response');
  const value = input as DownloadedSource;
  if (typeof value.url !== 'string' || typeof value.source !== 'string' || new TextEncoder().encode(value.source).length > 2 * 1024 * 1024 || value.source.includes('\0')) throw new Error('Invalid source file');
  return { url: sourceURL(value.url), source: value.source };
}

/** One editor download at a time; cancellation also rejects late legacy-port results. */
export function createSourceLoader(load: ((url: string, signal?: AbortSignal) => Promise<DownloadedSource>) | undefined, setActive: (active: boolean) => void) {
  let active: AbortController | undefined;
  let closed = false;
  return {
    async fetch(url: string) {
      if (closed || !load) throw new Error('Source download unavailable.');
      if (active) throw new Error('Wait for the download to finish.');
      const operation = new AbortController();
      active = operation;
      setActive(true);
      try {
        const source = await load(url, operation.signal);
        if (operation.signal.aborted) throw new Error('Download cancelled.');
        return source;
      } finally {
        if (active === operation) active = undefined;
        setActive(false);
      }
    },
    cancel() { active?.abort(); },
    close() { closed = true; active?.abort(); },
  };
}

/** Preserve native lifecycle cancellation across the WebUI error envelope. */
export function sourceDownloadError(message: string): Error {
  return message === 'Source download cancelled' || message === 'Source editor document expired' || message === 'Native connection closed'
    ? new DOMException(message, 'AbortError') : new Error(message);
}
