import type { CompiledStyle } from './style-compile';
import type { UserCSSValues } from './usercss-types';
import { sourceURL, type DownloadedSource } from './source-files';
import { decodeStyleImports, type StyleImports, type StyleCompileContext } from './style-imports';
export interface StyleCompiler {
  compile(source: string, values?: UserCSSValues, context?: StyleCompileContext): Promise<CompiledStyle>;
  cancel(): void;
  close(): void;
}
export function createStyleCompiler(loadImport?: (url: string, signal?: AbortSignal) => Promise<DownloadedSource>, workerURL?: URL): StyleCompiler {
  let cancel: (() => void) | undefined;
  let closed = false;
  let bundledSource: string | undefined;
  // Folder snapshots are immutable; validate a shared snapshot only once per batch.
  const snapshots = new WeakMap<StyleImports, Map<string, DownloadedSource>>();
  return {
    compile(source, values = {}, context = {}) {
      if (closed) return Promise.reject(new Error('Style editor closed.'));
      cancel?.();
      return new Promise((resolve,reject) => {
        let worker: Worker | undefined;
        let blobURL: string | undefined;
        const abort = new AbortController();
        // Keep the directory snapshot in the shell; send only imports actually
        // requested by this style, rather than cloning the whole tree per worker.
        let localImports = context.imports && snapshots.get(context.imports);
        if (!localImports) {
          localImports = new Map(Object.entries(decodeStyleImports(context.imports ?? {}, true)));
          if (context.imports) snapshots.set(context.imports, localImports);
        }
        const dependencies = localImports;
        let done = false;
        const finish = (error?: Error, value?: CompiledStyle) => {
          if (done) return;
          done = true; clearTimeout(timer); abort.abort(); worker?.terminate();
          if (blobURL) URL.revokeObjectURL(blobURL);
          cancel = undefined;
          if (error) reject(error); else resolve(value!);
        };
        const timer = setTimeout(() => finish(new Error('Style compilation or dependency download timed out.')), loadImport ? 30000 : 5000);
        cancel = () => finish(new Error('Compilation cancelled.'));
        const start = async () => {
          // Internal resource URLs have opaque origins in Ladybird. Fetch the
          // bundled compiler as the shell, then give its worker a local Blob URL.
          let url: URL;
          if (workerURL) {
            url = workerURL;
          } else if (typeof window !== 'undefined') {
            const asset = await import('./style-compiler.worker?worker&url');
            url = new URL(asset.default, import.meta.url);
          } else {
            const workerPath = './style-compiler.worker.ts';
            url = new URL(workerPath, import.meta.url);
          }
          if (url.protocol === 'resource:') {
            if (bundledSource === undefined) {
              const response = await fetch(url, { signal: abort.signal });
              if (!response.ok) throw new Error('Could not load the style compiler.');
              const source = await response.text();
              if (done) return;
              bundledSource = source;
            }
            if (done) return;
            blobURL = URL.createObjectURL(new Blob([bundledSource], { type: 'text/javascript' }));
            url = new URL(blobURL);
          }
          if (done) return;
          worker = new Worker(url, { type: 'module' });
          let importQueue = Promise.resolve();
          let importCount = 0;
          worker.onmessage = event => {
            if (done) return;
            if (Number.isSafeInteger(event.data?.importId)) {
              const { importId, url } = event.data;
              if (++importCount > 32) { finish(new Error('At most 32 style dependencies are allowed.')); return; }
              importQueue = importQueue.then(async () => {
                if (done) return;
                try {
                  const address = sourceURL(url);
                  const cached = dependencies.get(address);
                  if (!cached && new URL(address).hostname === 'derpbird-source.invalid')
                    throw new Error('Local dependency missing from the selected folder: ' + address);
                  const value = cached ?? await loadImport?.(address, abort.signal);
                  if (!value) throw new Error('Style dependency downloads unavailable.');
                  if (!done) worker?.postMessage({ importId, value });
                } catch (error) {
                  if (!done) worker?.postMessage({ importId, error: error instanceof Error ? error.message : String(error) });
                }
              });
              return;
            }
            event.data?.ok ? finish(undefined,event.data.value) : finish(new Error(event.data?.error || 'Style compilation failed.'));
          };
          worker.onerror = event => finish(new Error(event.message || 'Could not start the style compiler.'));
          worker.postMessage({ source, values, context: { sourceURL: context.sourceURL, importURLs: [...dependencies.keys()] } });
        };
        void start().catch(error => finish(error instanceof Error ? error : new Error(String(error))));
      });
    },
    cancel() { cancel?.(); },
    close() { closed = true; cancel?.(); bundledSource = undefined; },
  };
}
