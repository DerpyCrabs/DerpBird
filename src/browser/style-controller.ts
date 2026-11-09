import { reconcileStyleFolders, syncStyleFolders } from './source-folder-sync';
import { styleDownloadURL } from './source-updates';
import { createSourceLoader, readSourceFile } from './source-files';
import { createStyleCompiler, type StyleCompiler } from './style-compiler';
import type { UserCSSMetadata, UserCSSValue } from './usercss-types';
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import type { StyleSnapshot, StyleMatchStatus, UserStyle, UserStylePort } from './style-protocol';

type Draft = Pick<UserStyle, 'id' | 'name' | 'source' | 'sourceURL' | 'sourceBaseURL' | 'dependencyRevision' | 'imports' | 'checkUpdates' | 'checkedAt' | 'pendingUpdate' | 'updateError' | 'enabled' | 'usercss'>;
export interface StyleModel {
  readonly matchStatus: StyleMatchStatus | null;
  readonly updateReview: string | null;
  readonly directories: readonly string[];
  readonly configuration: UserCSSMetadata | null;
  readonly snapshot: StyleSnapshot | null;
  readonly draft: Draft | null;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly busy: boolean;
  readonly downloading: boolean;
  readonly compiling: boolean;
  readonly error: string | null;
  readonly confirmingRemoval: boolean;
}

export function createStyleController(port: UserStylePort, compiler: StyleCompiler = createStyleCompiler(port.fetchSource?.bind(port))) {
  let state: StyleModel = { matchStatus: null, updateReview: null, directories: [], configuration: null, snapshot: null, draft: null, dirty: false, conflict: false, busy: false, downloading: false, compiling: false, error: null, confirmingRemoval: false };
  const owner = modelOwner<StyleModel>(state);
  let disposed = false;
  const downloads = new AbortController();
  const patch = (change: Partial<StyleModel>) => {
    if (disposed) return;
    state = { ...state, ...change };
    owner.patch(change);
  };
  const sourceLoader = createSourceLoader(port.fetchSource?.bind(port), downloading => patch({ downloading }));
  const run = (work: () => Promise<void>) => {
    if (disposed || state.busy) return;
    patch({ busy: true, error: null });
    owner.run(['styles'], Effect.tryPromise({ try: async () => {
      try { if (!disposed) await work(); }
      finally { patch({ busy: false }); }
    }, catch: error => error }).pipe(Effect.catch(error => Effect.sync(() => patch({ error: error instanceof Error ? error.message : String(error) })))), 'queue');
  };
  const canLeaveDraft = () => {
    if (state.busy || disposed) return false;
    if (state.dirty) { patch({ error: 'Save or discard your changes first.' }); return false; }
    return true;
  };
  const draftOf = (item: UserStyle): Draft => ({ id: item.id, name: item.name, source: item.source, sourceURL: item.sourceURL, sourceBaseURL: item.sourceBaseURL, dependencyRevision: item.dependencyRevision, imports: item.imports, checkUpdates: item.checkUpdates, checkedAt: item.checkedAt, pendingUpdate: item.pendingUpdate, updateError: item.updateError, enabled: item.enabled, ...(item.usercss ? { usercss: item.usercss } : {}) });
  const accept = (snapshot: StyleSnapshot, selectedId?: string) => {
    const item = snapshot.items.find(item => item.id === selectedId) ?? snapshot.items[0];
    patch({ matchStatus: null, updateReview: null, configuration: null, snapshot, draft: item ? draftOf(item) : null, dirty: false, conflict: false, confirmingRemoval: false });
  };
  return {
    source: owner.source,
    state: () => state,
    refreshStatus() {
      if (!port.status) return;
      run(async () => {
        patch({ matchStatus: null });
        const status = await port.status!();
        if (disposed) return;
        if (status.revision !== state.snapshot?.revision) throw new Error('Styles changed. Reload the list before checking status.');
        patch({ matchStatus: status });
      });
    },
    load() {
      if (!canLeaveDraft()) return;
      run(async () => accept(await port.list(), state.draft?.id));
    },
    select(id: string) {
      if (!canLeaveDraft()) return;
      const item = state.snapshot?.items.find(item => item.id === id);
      if (item) patch({ updateReview: null, configuration: null, draft: draftOf(item), error: null, confirmingRemoval: false });
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
        const reconciled = await reconcileStyleFolders(port, folder, compiler, () => !disposed);
        if (reconciled && !disposed) accept(reconciled, state.draft?.id);
      });
    },
    reviewUpdate() {
      if (!canLeaveDraft() || !state.draft?.pendingUpdate) return;
      const previous = state.draft;
      const update = previous.pendingUpdate!;
      run(async () => {
        const { readUserCSS } = await import('./usercss-metadata');
        const before = readUserCSS(previous.source), after = readUserCSS(update.source);
        const updateReview = `Version ${before?.version || '—'} → ${after?.version || '—'}. Review the code before saving.`;
        const name = after?.name || previous.name;
        patch({ draft: { ...previous, name, source: update.source, sourceURL: update.url, imports: undefined, pendingUpdate: undefined, updateError: undefined }, dirty: true, updateReview, confirmingRemoval: false });
      });
    },
    cancelDownload() { sourceLoader.cancel(); },
    importURL(url: string, update = false) {
      if (!canLeaveDraft() || !state.snapshot || !port.fetchSource) return;
      const previous = update ? state.draft : null;
      run(async () => {
        const downloaded = await sourceLoader.fetch(previous ? styleDownloadURL(previous.source, previous.sourceURL ?? url) : url);
        if (disposed) return;
        const { readUserCSS } = await import("./usercss-metadata"); const name = readUserCSS(downloaded.source)?.name || new URL(downloaded.url).pathname.split("/").at(-1) || "New style";
        const id = previous?.id ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        const before = previous ? readUserCSS(previous.source) : null;
        const after = readUserCSS(downloaded.source);
        const updateReview = previous ? `Version ${before?.version || '—'} → ${after?.version || '—'}. Review the CSS and match scopes before saving.` : null;
        patch({ updateReview, draft: { ...previous, id, name, source: downloaded.source, sourceURL: downloaded.url, imports: undefined, pendingUpdate: undefined, updateError: undefined, checkedAt: Date.now(), enabled: previous?.enabled ?? true }, dirty: true, confirmingRemoval: false, configuration: null });
      });
    },
    importFile(file: File) {
      if (!canLeaveDraft() || !state.snapshot) return;
      run(async () => {
        const source = await readSourceFile(file);
        if (disposed) return;
        const { readUserCSS } = await import("./usercss-metadata");
        const metadata = readUserCSS(source);
        const name = metadata?.name || file.name;
        const sourceURL = metadata?.updateURL ? styleDownloadURL(source, metadata.updateURL) : undefined;
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        patch({ updateReview: null, draft: { id, name, source, sourceURL, enabled: true }, dirty: true, confirmingRemoval: false, configuration: null });
      });
    },
    create() {
      if (!canLeaveDraft() || !state.snapshot) return;
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      patch({ updateReview: null, configuration: null, draft: { id, name: 'New style', source: '@-moz-document domain("example.com") {\n  \n}\n', enabled: true }, dirty: true, error: null, confirmingRemoval: false });
    },
    change(change: Partial<Omit<Draft, 'id'>>) {
      if (disposed || state.busy || !state.draft) return;
      patch({ updateReview: change.source === undefined ? state.updateReview : null, configuration: change.source === undefined ? state.configuration : null, draft: { ...state.draft, ...change, ...(change.source === undefined ? {} : { imports: undefined }) }, dirty: true, error: null, confirmingRemoval: false });
    },
    configure() {
      const draft = state.draft;
      if (!draft) return;
      if (state.configuration) { patch({ configuration: null }); return; }
      run(async () => {
        const { readUserCSS } = await import('./usercss-metadata');
        patch({ configuration: readUserCSS(draft.source) });
      });
    },
    changeVariable(name: string, value: UserCSSValue) {
      if (disposed || state.busy || !state.draft || !state.configuration?.vars[name]) return;
      patch({ draft: { ...state.draft, usercss: { values: { ...state.draft.usercss?.values, [name]: value } } }, dirty: true, error: null });
    },
    resetVariables() {
      if (disposed || state.busy || !state.draft) return;
      patch({ draft: { ...state.draft, usercss: { values: {} } }, dirty: true, error: null });
    },
    discard() {
      if (state.busy || !state.snapshot) return;
      accept(state.snapshot, state.draft?.id);
      patch({ error: null });
    },
    cancelCompilation() { if (state.compiling) compiler.cancel(); },
    continueDraft() {
      if (disposed || state.busy || !state.conflict) return;
      patch({ conflict: false, error: null });
    },
    reloadLatest() {
      if (disposed || state.busy) return;
      run(async () => {
        const id = state.draft?.id;
        if (id?.startsWith('folder_')) await syncStyleFolders(port, () => !disposed, downloads.signal);
        if (!disposed) accept(await port.list(), id);
      });
    },
    save() {
      const { draft, snapshot } = state;
      if (!draft || !snapshot || !state.dirty || state.conflict) return;
      run(async () => {
        if (!draft.name.trim()) throw new Error('Enter a style name.');
        let imports = draft.imports;
        if (draft.sourceBaseURL && port.folders) {
          const folder = await port.folders('list');
          if (disposed) return;
          if (folder.error) throw new Error(folder.error);
          if (!folder.files.some(file => file.id === draft.id)) throw new Error('Style file removed from its source folder. Your draft is preserved.');
          // Never revive a deleted local dependency from a persisted cache.
          const remote = Object.fromEntries(Object.entries(imports ?? {}).filter(([url]) => new URL(url).hostname !== 'derpbird-source.invalid'));
          imports = { ...remote, ...folder.imports };
        }
        patch({ compiling: true });
        const compiled = await compiler.compile(draft.source, draft.usercss?.values, { sourceURL: draft.sourceBaseURL ?? draft.sourceURL, imports }).finally(() => patch({ compiling: false }));
        const { usercss: _previous, imports: _previousImports, ...base } = draft;
        const item: UserStyle = { ...base, name: draft.name === 'New style' && compiled.metadata ? compiled.metadata.name : draft.name.trim(),
          sections: compiled.sections, ...(compiled.imports ? { imports: compiled.imports } : {}), ...(compiled.metadata ? { usercss: { values: compiled.values } } : {}) };
        if (disposed) return;
        // Refresh selected directory sources at the commit boundary. Automatic
        // scans are deferred while editing, so registry-only comparison would
        // miss a file changed on disk while the draft was open.
        if (draft.id.startsWith('folder_')) await syncStyleFolders(port, () => !disposed, downloads.signal);
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
      downloads.abort();
      sourceLoader.close();
      compiler.close();
      await Effect.runPromise(owner.close());
    },
  };
}
export type StyleController = ReturnType<typeof createStyleController>;
