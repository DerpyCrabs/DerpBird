import { reconcileScriptFolders, syncScriptFolders } from './source-folder-sync';
import { describeScriptUpdate } from './script-update-review';
import { scriptDownloadURL } from './source-updates';
import { createSourceLoader, readSourceFile } from './source-files';
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import type { ScriptSnapshot, UserScript, UserScriptPort } from './script-protocol';

type Draft = Pick<UserScript, 'id' | 'name' | 'source' | 'sourceURL' | 'dependencyRevision' | 'checkUpdates' | 'checkedAt' | 'pendingUpdate' | 'updateError' | 'enabled'>;
export interface ScriptModel {
  readonly updateReview: string | null;
  readonly directories: readonly string[];
  readonly snapshot: ScriptSnapshot | null;
  readonly draft: Draft | null;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly busy: boolean;
  readonly downloading: boolean;
  readonly error: string | null;
  readonly confirmingRemoval: boolean;
}

export function createScriptController(port: UserScriptPort) {
  let state: ScriptModel = { updateReview: null, directories: [], snapshot: null, draft: null, dirty: false, conflict: false, busy: false, downloading: false, error: null, confirmingRemoval: false };
  const owner = modelOwner<ScriptModel>(state);
  let disposed = false;
  const patch = (change: Partial<ScriptModel>) => {
    if (disposed) return;
    state = { ...state, ...change };
    owner.patch(change);
  };
  const sourceLoader = createSourceLoader(port.fetchSource?.bind(port), downloading => patch({ downloading }));
  const run = (work: () => Promise<void>) => {
    if (disposed || state.busy) return;
    patch({ busy: true, error: null });
    owner.run(['scripts'], Effect.tryPromise({ try: async () => {
      try { if (!disposed) await work(); }
      finally { patch({ busy: false }); }
    }, catch: error => error }).pipe(Effect.catch(error => Effect.sync(() => patch({ error: error instanceof Error ? error.message : String(error) })))), 'queue');
  };
  const canLeaveDraft = () => {
    if (state.busy || disposed) return false;
    if (state.dirty) { patch({ error: 'Save or discard your changes first.' }); return false; }
    return true;
  };
  const draftOf = (item: UserScript): Draft => ({ id: item.id, name: item.name, source: item.source, sourceURL: item.sourceURL, dependencyRevision: item.dependencyRevision, checkUpdates: item.checkUpdates, checkedAt: item.checkedAt, pendingUpdate: item.pendingUpdate, updateError: item.updateError, enabled: item.enabled });
  const accept = (snapshot: ScriptSnapshot, selectedId?: string) => {
    const item = snapshot.items.find(item => item.id === selectedId) ?? snapshot.items[0];
    patch({ updateReview: null, snapshot, draft: item ? draftOf(item) : null, dirty: false, conflict: false, confirmingRemoval: false });
  };
  return {
    source: owner.source,
    state: () => state,
    load() {
      if (!canLeaveDraft()) return;
      run(async () => accept(await port.list(), state.draft?.id));
    },
    select(id: string) {
      if (!canLeaveDraft()) return;
      const item = state.snapshot?.items.find(item => item.id === id);
      if (item) patch({ updateReview: null, draft: draftOf(item), error: null, confirmingRemoval: false });
    },
    folders(action: 'list' | 'add' | 'remove' = 'list', path?: string) {
      if (!canLeaveDraft() || !port.folders) return;
      run(async () => {
        const folder = await port.folders!(action, path);
        if (disposed) return;
        patch({ directories: folder.directories });
        if (folder.error) {
          const snapshot = await port.list();
          if (disposed) return;
          accept(snapshot, state.draft?.id);
          throw new Error(folder.error);
        }
        const reconciled = await reconcileScriptFolders(port, folder, () => !disposed);
        if (reconciled && !disposed) accept(reconciled, state.draft?.id);
      });
    },
    setFileAccess(granted: boolean) {
      if (!canLeaveDraft() || !state.snapshot || !state.draft || !port.setFileAccess) return;
      const id = state.draft.id;
      const revision = state.snapshot.revision;
      if (!state.snapshot.items.some(item => item.id === id)) return;
      run(async () => accept(await port.setFileAccess!(id, granted, revision), id));
    },
    reviewUpdate() {
      if (!canLeaveDraft() || !state.draft?.pendingUpdate) return;
      const previous = state.draft;
      const update = previous.pendingUpdate!;
      run(async () => {
        const { parseUserScript } = await import('./user-scripts');
        const before = parseUserScript(previous.source, previous.sourceURL), after = parseUserScript(update.source, update.url);
        const updateReview = describeScriptUpdate(before, after);
        const name = after.name;
        patch({ draft: { ...previous, name, source: update.source, sourceURL: update.url, pendingUpdate: undefined, updateError: undefined }, dirty: true, updateReview, confirmingRemoval: false });
      });
    },
    cancelDownload() { sourceLoader.cancel(); },
    importURL(url: string, update = false) {
      if (!canLeaveDraft() || !state.snapshot || !port.fetchSource) return;
      const previous = update ? state.draft : null;
      run(async () => {
        const address = previous ? scriptDownloadURL(previous.source, previous.sourceURL ?? url) : url;
        if (!address) throw new Error('The author disabled updates with @downloadURL none. Import a new file manually.');
        const downloaded = await sourceLoader.fetch(address);
        if (disposed) return;
        const { parseUserScript } = await import("./user-scripts");
        const metadata = parseUserScript(downloaded.source, downloaded.url);
        const name = metadata.name;
        const updateReview = previous ? describeScriptUpdate(parseUserScript(previous.source, previous.sourceURL), metadata) : null;
        const id = previous?.id ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        patch({ draft: { ...previous, id, name, source: downloaded.source, sourceURL: downloaded.url, pendingUpdate: undefined, updateError: undefined, checkedAt: Date.now(), enabled: previous?.enabled ?? true }, dirty: true, updateReview, confirmingRemoval: false });
      });
    },
    importFile(file: File) {
      if (!canLeaveDraft() || !state.snapshot) return;
      run(async () => {
        const source = await readSourceFile(file);
        if (disposed) return;
        const { parseUserScript } = await import("./user-scripts"); const name = parseUserScript(source).name || file.name;
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        patch({ updateReview: null, draft: { id, name, source, enabled: true }, dirty: true, confirmingRemoval: false });
      });
    },
    create() {
      if (!canLeaveDraft() || !state.snapshot) return;
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      patch({ updateReview: null, draft: { id, name: 'New script', source: '// ==UserScript==\n// @name New script\n// @match https://example.com/*\n// @run-at document-end\n// ==/UserScript==\n\n', enabled: true }, dirty: true, error: null, confirmingRemoval: false });
    },
    change(change: Partial<Omit<Draft, 'id'>>) {
      if (disposed || state.busy || !state.draft) return;
      patch({ updateReview: change.source === undefined ? state.updateReview : null, draft: { ...state.draft, ...change }, dirty: true, error: null, confirmingRemoval: false });
    },
    discard() {
      if (state.busy || !state.snapshot) return;
      accept(state.snapshot, state.draft?.id);
      patch({ error: null });
    },
    continueDraft() {
      if (disposed || state.busy || !state.conflict) return;
      patch({ conflict: false, error: null });
    },
    reloadLatest() {
      if (disposed || state.busy) return;
      run(async () => {
        const id = state.draft?.id;
        if (id?.startsWith('folder_')) await syncScriptFolders(port, () => !disposed);
        if (!disposed) accept(await port.list(), id);
      });
    },
    save() {
      const { draft, snapshot } = state;
      if (!draft || !snapshot || !state.dirty || state.conflict) return;
      run(async () => {
        if (!draft.name.trim()) throw new Error('Enter a script name.');
        // Parse metadata only on save; never execute the script in the shell.
        const { parseUserScript } = await import('./user-scripts');
        const item: UserScript = { ...draft, name: draft.name.trim(), metadata: parseUserScript(draft.source, draft.sourceURL), fileAccessGranted: false };
        if (disposed) return;
        // Refresh selected directory sources at the commit boundary. Automatic
        // scans are deferred while editing, so registry-only comparison would
        // miss a file changed on disk while the draft was open.
        if (draft.id.startsWith('folder_')) await syncScriptFolders(port, () => !disposed);
        if (disposed) return;
        const latest = await port.list();
        if (disposed) return;
        const original = snapshot.items.find(old => old.id === item.id);
        const current = latest.items.find(old => old.id === item.id);
        if (item.id.startsWith('folder_') && !current)
          throw new Error('Source disconnected. Restore the file or folder before saving. Your draft is preserved.');
        if (JSON.stringify(original && draftOf(original)) !== JSON.stringify(current && draftOf(current))) {
          patch({ snapshot: latest, conflict: true });
          throw new Error('Source changed outside the editor. Your draft is preserved. Choose which version to keep.');
        }
        // A conflict acknowledgement rebases the local draft onto the current
        // disk snapshot. Do not let the next folder scan immediately undo it.
        const savedItem = current && item.id.startsWith('folder_')
          ? { ...item, dependencyRevision: current.dependencyRevision } : item;
        const items = current ? latest.items.map(old => old.id === item.id ? savedItem : old) : [...latest.items, savedItem];
        accept(await port.replace({ revision: latest.revision, items }), item.id);
      });
    },
    requestRemove() {
      if (state.draft && canLeaveDraft()) patch({ confirmingRemoval: true });
    },
    cancelRemove() { if (!state.busy) patch({ confirmingRemoval: false }); },
    remove() {
      const { draft, snapshot } = state;
      if (!draft || !snapshot || !state.confirmingRemoval || !canLeaveDraft()) return;
      run(async () => accept(await port.replace({ revision: snapshot.revision, items: snapshot.items.filter(item => item.id !== draft.id) })));
    },
    async close() {
      disposed = true;
      sourceLoader.close();
      await Effect.runPromise(owner.close());
    },
  };
}
export type ScriptController = ReturnType<typeof createScriptController>;
