import { decodePageSources, type PageSourcesPort } from './page-sources';
import { decodeProxySnapshot, type ProxyPort } from './proxy-protocol';
import { decodeImportStatus, decodeImportReport, type ImportPort } from './import-protocol';
import { decodeSourceFolders, decodeDownloadedSource, sourceURL, sourceDownloadError } from './source-files';
import { decodeCapturedCredential, validateCaptureToken, decodeCredentialExceptions, validateCredentialOrigin } from './credential-protocol';
import { decodeCredential, decodeCredentials, decodeRevealedCredential, validateCredentialDraft, type CredentialPort } from './credential-protocol';
import { decodeScriptSnapshot, type UserScriptPort } from './script-protocol';
import type { Command, NativePort } from './protocol';
import { decodeStyleSnapshot, decodeStyleMatchStatus, type UserStylePort } from './style-protocol';

export interface WebUIChannel { sendMessage(name: string, data: unknown): void }
interface Response { requestId: number; ok: boolean; value?: unknown; error?: string }
export interface WebUIPort extends NativePort { devtoolsRequest(payload: Record<string, unknown>): Promise<unknown>; onDevTools(listener: (value: unknown) => void): () => void; readonly pageSources: PageSourcesPort; autofill(token: string, id?: string): Promise<void>; readonly proxy: ProxyPort; readonly importer: ImportPort; readonly styles: UserStylePort; readonly scripts: UserScriptPort; readonly credentials: CredentialPort; onSourceChange(listener: () => void): () => void; close(): void }

/** Adapter for Ladybird's document-scoped WebUI IPC. Never used on content pages. */
export function createWebUIPort(
  document: EventTarget,
  getChannel: () => WebUIChannel | undefined,
  { timeoutMs = 30_000, maxPending = 128 } = {},
): WebUIPort {
  let nextId = 1;
  let closed = false;
  const devtoolsListeners = new Set<(value: unknown) => void>();
  const sourceListeners = new Set<() => void>();
  const listeners = new Set<(snapshot: unknown) => void>();
  const pending = new Map<number, {
    cleanup: () => void;
    cancelNative: () => void;
    payload: unknown;
    sent: boolean;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const fail = (id: number, error: Error, cancelNative = false) => {
    const request = pending.get(id);
    if (!request) return;
    request.cleanup();
    clearTimeout(request.timer);
    pending.delete(id);
    if (cancelNative && request.sent) request.cancelNative();
    const type = (request.payload as { type?: string })?.type;
    request.reject(type === 'scripts.fetch' || type === 'styles.fetch' ? sourceDownloadError(error.message) : error);
  };
  const flush = () => {
    if (closed) return;
    const channel = getChannel();
    if (!channel) return;
    for (const [requestId, request] of pending) {
      if (request.sent) continue;
      request.sent = true;
      try { channel.sendMessage('derpbird.request', { requestId, payload: request.payload }); }
      catch (error) { fail(requestId, error instanceof Error ? error : new Error(String(error))); }
    }
  };
  const rpc = (payload: unknown, deadline = timeoutMs, signal?: AbortSignal) => new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) { reject(sourceDownloadError('Source download cancelled')); return; }
    if (closed) { reject(new Error('Native connection closed')); return; }
    if (pending.size >= maxPending) { reject(new Error('Too many pending native requests')); return; }
    const requestId = nextId++;
    const timer = setTimeout(() => fail(requestId, new Error('Native request timed out'), true), deadline);
    const sourceFetch = (payload as { type?: string })?.type;
    const isSourceFetch = sourceFetch === 'scripts.fetch' || sourceFetch === 'styles.fetch';
    const cancelNative = () => {
      if (!isSourceFetch) return;
      // Never cancel a newer operation when a timeout/abort arrives late.
      try { getChannel()?.sendMessage('derpbird.request', { requestId: nextId++, payload: { type: 'sources.cancel', downloadToken: String(requestId) } }); } catch {}
    };
    const cancel = () => fail(requestId, sourceDownloadError('Source download cancelled'), true);
    if (isSourceFetch) payload = { ...(payload as object), downloadToken: String(requestId) };
    pending.set(requestId, { payload, sent: false, resolve, reject, timer, cancelNative, cleanup: () => signal?.removeEventListener('abort', cancel) });
    signal?.addEventListener('abort', cancel, { once: true });
    flush();
  });
  const receive = (event: Event) => {
    if (closed) return;
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== 'object') return;
    const { name, data } = detail as { name?: unknown; data?: unknown };
    if (name === 'derpbird.devtools') { for (const listener of devtoolsListeners) listener(data); return; }
    if (name === 'derpbird.sources-changed') { for (const listener of sourceListeners) listener(); return; }
    if (name === 'derpbird.snapshot') {
      for (const listener of listeners) listener(data);
      return;
    }
    if (name !== 'derpbird.response' || !data || typeof data !== 'object') return;
    const response = data as Response;
    if (!Number.isSafeInteger(response.requestId) || typeof response.ok !== 'boolean') return;
    const request = pending.get(response.requestId);
    if (!request || !request.sent) return;
    if (!response.ok) {
      const message = typeof response.error === 'string' ? response.error : 'Native request failed';
      fail(response.requestId, new Error(message));
      return;
    }
    request.cleanup();
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    request.resolve(response.value);
  };
  document.addEventListener('WebUILoaded', flush);
  document.addEventListener('WebUIMessage', receive);
  return {
    version: 1,
    devtoolsRequest: payload => rpc(payload),
    onDevTools(listener) { devtoolsListeners.add(listener); return () => { devtoolsListeners.delete(listener); }; },
    async autofill(token, id) { await rpc(id ? { type: "credentials.autofill", token, id } : { type: "credentials.autofill-dismiss" }); },
    proxy: {
      get: async () => decodeProxySnapshot(await rpc({ type: 'proxy.get' })),
      replace: async snapshot => decodeProxySnapshot(await rpc({ type: 'proxy.replace', ...decodeProxySnapshot(snapshot) })),
    },
    importer: {
      status: async () => decodeImportStatus(await rpc({ type: 'import.status' })),
      dismiss: async () => { await rpc({ type: 'import.dismiss' }); },
      chrome: async selection => decodeImportReport(await rpc({ type: 'import.chrome', ...selection }, 300_000)),
      passwords: async () => decodeImportReport(await rpc({ type: 'import.passwords' }, 300_000)),
    },
    onSourceChange(listener) { sourceListeners.add(listener); return () => { sourceListeners.delete(listener); }; },
    credentials: {
      exceptions: {
        list: async () => decodeCredentialExceptions(await rpc({ type: 'credentials.exceptions' })),
        never: async token => decodeCredentialExceptions(await rpc({ type: 'credentials.capture-never', token: validateCaptureToken(token) })),
        allow: async origin => decodeCredentialExceptions(await rpc({ type: 'credentials.allow-origin', origin: validateCredentialOrigin(origin), id: '', revision: '0' })),
      },
      capture: {
        read: async () => decodeCapturedCredential(await rpc({ type: 'credentials.capture' })),
        save: async (token, target) => {
          const entry = target ? decodeCredential(target) : null;
          return decodeCredential(await rpc({ type: 'credentials.capture-save', token: validateCaptureToken(token), id: entry?.id ?? '', revision: entry?.revision ?? '0' }));
        },
        cancel: async token => { await rpc({ type: 'credentials.capture-cancel', token: validateCaptureToken(token) }); },
      },
      fill: async entry => {
        const { id, origin, revision } = decodeCredential(entry);
        await rpc({ type: 'credentials.fill', id, origin, revision });
      },
      copy: async entry => {
        const { id, origin, revision } = decodeCredential(entry);
        await rpc({ type: 'credentials.copy', id, origin, revision });
      },
      reveal: async entry => {
        const { id, origin, revision } = decodeCredential(entry);
        return decodeRevealedCredential(await rpc({ type: 'credentials.reveal', id, origin, revision }));
      },
      list: async () => decodeCredentials(await rpc({ type: 'credentials.list' })),
      save: async draft => decodeCredential(await rpc({ type: 'credentials.save', ...validateCredentialDraft(draft) })),
      remove: async entry => {
        const { id, origin, revision } = decodeCredential(entry);
        await rpc({ type: 'credentials.remove', id, origin, revision });
      },
    },
    pageSources: {
      page: async () => decodePageSources(await rpc({ type: 'sources.page' })),
      toggle: async (page, kind, id, enabled) => decodePageSources(await rpc({ type: 'sources.toggle', kind, id, enabled, tabId: page.tabId, url: page.url, revision: kind === 'styles' ? page.styleRevision : page.scriptRevision })),
    },
    styles: {
      status: async () => decodeStyleMatchStatus(await rpc({ type: 'styles.status' })),
      fetchSource: async (url, signal) => decodeDownloadedSource(await rpc({ type: 'styles.fetch', url: sourceURL(url) }, timeoutMs, signal)),
      folders: async (action, path) => decodeSourceFolders(await rpc({ type: 'styles.folders', action, path }, action === 'add' ? 300_000 : timeoutMs)),
      list: async () => decodeStyleSnapshot(await rpc({ type: 'styles.list' })),
      replace: async snapshot => {
        const validated = decodeStyleSnapshot(snapshot);
        return decodeStyleSnapshot(await rpc({ type: 'styles.replace', ...validated }));
      },
    },
    scripts: {
      setFileAccess: async (id, granted, revision) => decodeScriptSnapshot(await rpc({ type: 'scripts.file-access', id, granted, revision })),
      fetchSource: async (url, signal) => decodeDownloadedSource(await rpc({ type: 'scripts.fetch', url: sourceURL(url) }, timeoutMs, signal)),
      folders: async (action, path) => decodeSourceFolders(await rpc({ type: 'scripts.folders', action, path }, action === 'add' ? 300_000 : timeoutMs)),
      list: async () => decodeScriptSnapshot(await rpc({ type: 'scripts.list' })),
      replace: async snapshot => {
        const validated = decodeScriptSnapshot(snapshot);
        return decodeScriptSnapshot(await rpc({ type: 'scripts.replace', ...validated }));
      },
    },
    snapshot: () => rpc({ type: 'snapshot' }),
    request: async (command: Command) => { await rpc({ type: 'command', command }); },
    subscribe(listener) {
      if (closed) throw new Error('Native connection closed');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close() {
      if (closed) return;
      closed = true;
      sourceListeners.clear();
      devtoolsListeners.clear();
      document.removeEventListener('WebUILoaded', flush);
      document.removeEventListener('WebUIMessage', receive);
      listeners.clear();
      for (const id of pending.keys()) fail(id, new Error('Native connection closed'), true);
    },
  };
}
