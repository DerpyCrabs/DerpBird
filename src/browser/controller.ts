import type { WorkspaceDraft } from './workspaces';
import { paletteItems } from './address-palette';
import type { PageSources } from './page-sources';
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import { decodeSnapshot, navigationTarget, type ScriptCommand, type BrowserPage, type BrowserSnapshot, type Command, type NativePort } from './protocol';
export type Panel = 'menu' | 'blocking' | null;
export type { ChromeLayout } from './chrome-layout';
import { type ChromeLayout, verticalLayout } from './chrome-layout';
export interface ShellModel {
  readonly workspaceEditor?: WorkspaceDraft | null;
  readonly chromeLayout?: ChromeLayout;
  readonly paletteFilter?: string;
  readonly addressPaletteOpen?: boolean;
  readonly pageSources?: PageSources;
  readonly sidebarWidth: number;
  readonly sidebarResizeWidth: number | null;
  readonly wrapTabs: boolean;
  readonly dynamicDraft: string | null;
  readonly addressInput: string | null;
  readonly addressSuggestionsOpen: boolean;
  readonly addressQuery: number;
  readonly addressSelection: number;
  readonly browser: BrowserSnapshot;
  readonly connected: boolean;
  readonly layout: 'vertical' | 'horizontal';
  readonly panel: Panel;
  readonly blockingSearch: string;
  readonly tabMenu: { readonly tabId: string; readonly x: number; readonly y: number } | null;
  readonly error: string | null;
}
const empty: BrowserSnapshot = { version: 1, revision: -1, preferences: { layout: 'vertical' }, tabs: [], activeTabId: null };

export function createController(port?: NativePort) {
  const owner = modelOwner<ShellModel>({ sidebarWidth: 196, sidebarResizeWidth: null, wrapTabs: false, dynamicDraft: null, addressInput: null, addressSuggestionsOpen: false, addressQuery: 0, addressSelection: -1, browser: empty, connected: false, layout: 'vertical', panel: null, blockingSearch: '', tabMenu: null, error: null });
  let state: ShellModel = { sidebarWidth: 196, sidebarResizeWidth: null, wrapTabs: false, dynamicDraft: null, addressInput: null, addressSuggestionsOpen: false, addressQuery: 0, addressSelection: -1, browser: empty, connected: false, layout: 'vertical', panel: null, blockingSearch: '', tabMenu: null, error: null };
  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  let disposed = false;
  let paletteTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingNavigation: { tabId: string; previousURL: string } | null = null;
  let unsubscribe: (() => void) | undefined;
  const patch = (value: Partial<ShellModel>) => {
    if (disposed) return;
    state = { ...state, ...value };
    owner.patch(value);
  };
  const report = (error: unknown) => { patch({ error: error instanceof Error ? error.message : String(error) }); resolveReady(); };
  const accept = (raw: unknown) => {
    if (disposed) return;
    try {
      const next = decodeSnapshot(raw);
      if (next.revision <= state.browser.revision) return;
      resolveReady();
      // Keep untouched tab objects stable across native snapshots to skip row rendering.
      const previous = new Map(state.browser.tabs.map(tab => [tab.id, tab]));
      const tabs = next.tabs.map(tab => {
        const old = previous.get(tab.id);
        return old && Object.keys(old).length === Object.keys(tab).length && (Object.keys(tab) as (keyof typeof tab)[]).every(key => old[key] === tab[key]) ? old : tab;
      });
      const nextLayout = next.preferences.chromeLayout ?? {preset: next.preferences.layout === 'vertical' ? 'sidebar' : 'classic', side:'left', address:'top'} as ChromeLayout;
      const layoutChanged = state.chromeLayout && JSON.stringify(state.chromeLayout) !== JSON.stringify(nextLayout);
      const activeChanged = next.activeTabId !== state.browser.activeTabId;
      const navigationArrived = pendingNavigation && next.tabs.some(tab => tab.id === pendingNavigation!.tabId && tab.url !== pendingNavigation!.previousURL);
      if (activeChanged || navigationArrived) {
        pendingNavigation = null;
      }
      patch({ ...(state.addressPaletteOpen && next.addressSuggestions?.query === state.addressQuery ? {paletteFilter: state.addressInput ?? ''} : {}), ...(activeChanged || navigationArrived || layoutChanged ? { addressPaletteOpen: false, addressInput: null, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 } : {}), ...next.preferences, chromeLayout: nextLayout, ...(state.sidebarResizeWidth === next.preferences.sidebarWidth ? { sidebarResizeWidth: null } : {}), browser: { ...next, tabs, addressSuggestions: next.addressSuggestions?.query === state.addressQuery ? next.addressSuggestions : state.browser.addressSuggestions }, connected: true, error: null, tabMenu: state.tabMenu && tabs.some(tab => tab.id === state.tabMenu!.tabId) ? state.tabMenu : null });
    } catch (error) { report(error); }
  };
  const send = (command: Command) => {
    if (disposed) return;
    if (!port || !state.connected) { report(new Error('Browser connection unavailable')); return; }
    const replacePending = command.type === 'shell.viewport' || command.type === 'browser.suggest' || command.type === 'split.resize';
    const lane = command.type === 'split.resize' ? 'split-resize' : command.type === 'shell.viewport' ? 'viewport' : command.type === 'browser.suggest' ? 'autocomplete' : 'command';
    owner.run([lane],
      Effect.tryPromise({ try: () => port.request(command), catch: error => error }).pipe(Effect.catch(error => Effect.sync(() => report(error)))), replacePending ? 'latest-queued' : 'queue');
  };
  if (port) {
    if (port.version !== 1) report(new Error('Incompatible browser version'));
    else {
      try {
        unsubscribe = port.subscribe(accept);
        owner.run(['snapshot'], Effect.tryPromise({ try: () => port.snapshot(), catch: error => error }).pipe(
          Effect.flatMap(raw => Effect.sync(() => accept(raw))),
          Effect.catch(error => Effect.sync(() => report(error))),
        ), 'replace');
      } catch (error) { report(error); }
    }
  }
  return {
    ready,
    openWorkspaceEditor(id?: string) {
      const workspace = state.browser.workspaces?.items.find(w => w.id === id);
      patch({panel:null, tabMenu:null, workspaceEditor:workspace ? {...workspace} : {name:'',icon:'research',color:'sage'}});
    },
    editWorkspace(value: Partial<WorkspaceDraft>) { if (state.workspaceEditor) patch({workspaceEditor:{...state.workspaceEditor,...value}}); },
    closeWorkspaceEditor() { patch({workspaceEditor:null}); },
    saveWorkspace() {
      const draft = state.workspaceEditor;
      if (!draft?.name.trim()) return;
      send({type:draft.id ? 'workspace.update' : 'workspace.create', ...draft, name:draft.name.trim()});
      patch({workspaceEditor:null});
    },
    switchWorkspace(id:string) { send({type:'workspace.switch',id}); patch({workspaceEditor:null,panel:null,tabMenu:null}); },
    source: owner.source,
    reportError: report,
    state: () => state,
    setPageSources: (pageSources?: PageSources) => patch({ pageSources }),
    send,
    openTabMenu(tabId: string, x: number, y: number) {
      if (!state.browser.tabs.some(tab => tab.id === tabId)) return;
      if (state.panel === 'blocking') send({ type: 'blocking.log', visible: false });
      patch({ tabMenu: { tabId, x, y }, panel: null });
    },
    closeTabMenu: () => patch({ tabMenu: null }),
    tabMenuAction(action: 'new-child' | 'ungroup' | 'close-group' | 'pin' | 'mute' | 'close' | 'duplicate' | 'close-others' | 'close-right' | 'previous' | 'next') {
      const tabId = state.tabMenu?.tabId;
      const index = state.browser.tabs.findIndex(tab => tab.id === tabId);
      const tab = state.browser.tabs[index];
      patch({ tabMenu: null });
      if (!tab) return;
      if (action === 'pin') send({ type: 'tab.pin', tabId: tab.id, value: !tab.pinned });
      else if (action === 'mute') send({ type: 'tab.mute', tabId: tab.id, value: !tab.muted });
      else if (action === 'new-child' || action === 'ungroup' || action === 'close-group' || action === 'close' || action === 'duplicate' || action === 'close-others' || action === 'close-right') send({ type: `tab.${action}`, tabId: tab.id });
      else {
        const siblings = state.browser.tabs.filter(item => item.parentId === tab.parentId && item.pinned === tab.pinned);
        const siblingIndex = siblings.findIndex(item => item.id === tab.id);
        const neighbor = siblings[siblingIndex + (action === 'previous' ? -1 : 1)];
        if (neighbor) send({ type: 'tab.move', tabId: tab.id, index: state.browser.tabs.indexOf(neighbor) });
      }
    },
    executeScriptCommand(command: ScriptCommand, input: MouseEvent | KeyboardEvent) {
      const tabId = state.browser.activeTabId;
      if (!tabId) return;
      send({type:'script.command',tabId,id:command.id,event:{keyboard:input.type.startsWith('key'),key:'key' in input ? input.key : '',ctrlKey:input.ctrlKey,altKey:input.altKey,shiftKey:input.shiftKey,metaKey:input.metaKey}});
      if(command.autoClose) patch({panel:null});
    },
    openPage(page: BrowserPage) {
      if (state.panel === 'blocking') send({ type: 'blocking.log', visible: false });
      send({ type: 'browser.open-page', page });
      patch({ panel: null });
    },
    previewSidebarWidth: (sidebarResizeWidth: number | null) => patch({ sidebarResizeWidth }),
    setSidebarWidth: (width: number) => send({ type: 'shell.set-sidebar-width', width }),
    setWrapTabs: (value: boolean) => send({ type: 'shell.set-wrap-tabs', value }),
    setChromeLayout(chromeLayout: ChromeLayout) {
      if (state.connected) send({ type: 'shell.set-chrome-layout', layout: chromeLayout });
      else patch({ chromeLayout, layout: verticalLayout(chromeLayout) ? 'vertical' : 'horizontal', addressPaletteOpen: false, addressSuggestionsOpen: false, addressInput: null });
    },
    selectPaletteItem(direction: number) {
      const count = paletteItems(state).length;
      if (count) patch({addressSelection: state.addressSelection < 0 ? (direction < 0 ? count - 1 : 0) : (state.addressSelection + direction + count) % count});
    },
    choosePaletteItem(index: number) {
      const item = paletteItems(state)[index];
      if (item?.source === 'tab') {
        send({type:'tab.activate',tabId:item.id});
        this.dismissAddress();
      } else this.navigate(item?.text ?? state.addressInput ?? '');
    },
    openAddressPalette() {
      const input = state.browser.tabs.find(tab => tab.id === state.browser.activeTabId)?.url ?? '';
      patch({ paletteFilter: input, addressPaletteOpen: true, addressInput: input === 'about:blank' || input === 'about:newtab' ? '' : input, addressSelection: -1, addressSuggestionsOpen: false });
    },
    blurAddress() {
      patch({ addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 });
    },
    focusAddress(input: string) {
      if (state.addressInput === null) patch({ addressInput: input });
    },
    editAddress(input: string) {
      pendingNavigation = null;
      const query = state.addressQuery + 1;
      patch({ ...(!input.trim() ? {paletteFilter: ''} : {}), addressInput: input, addressSuggestionsOpen: !!input.trim(), addressQuery: query, addressSelection: -1,
        // Keep a visible list stable during a new query, but never reopen old results.
        ...(!state.addressSuggestionsOpen ? { browser: { ...state.browser, addressSuggestions: undefined } } : {}) });
      clearTimeout(paletteTimer);
      const request = () => send({ type: 'browser.suggest', input: input.slice(0, 4096), query });
      if (state.addressPaletteOpen && input.trim()) {
        paletteTimer = setTimeout(() => {
          if (state.addressPaletteOpen && state.addressQuery === query) request();
        }, 160);
      } else request();
    },
    selectAddress(direction: number) {
      const suggestions = state.browser.addressSuggestions;
      if (!suggestions?.items.length) return;
      patch({ addressSelection: state.addressSelection < 0 ? (direction < 0 ? suggestions.items.length - 1 : 0) : (state.addressSelection + direction + suggestions.items.length) % suggestions.items.length });
    },
    dismissAddress() { pendingNavigation = null; patch({ addressPaletteOpen: false, addressInput: null, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 }); },
    navigate(input: string) {
      if (!input.trim()) return;
      try {
        const url = navigationTarget(input);
        const tabId = state.browser.activeTabId;
        pendingNavigation = tabId ? { tabId, previousURL: state.browser.tabs.find(tab => tab.id === tabId)?.url ?? '' } : null;
        send(tabId ? { type: 'tab.navigate-input', tabId, url: input } : { type: 'tab.create', url, private: false });
        patch({ addressPaletteOpen: false, addressInput: input, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 });
      } catch (error) { report(error); }
    },
    setLayout(layout: ShellModel['layout']) {
      if (state.connected) send({ type: 'shell.set-layout', layout }); else patch({ layout });
    },
    setPanel(panel: Panel) {
      if (panel === 'blocking' || state.panel === 'blocking') send({ type: 'blocking.log', visible: panel === 'blocking' });
      patch({ panel, dynamicDraft: panel === 'blocking' ? state.dynamicDraft : null, tabMenu: null, blockingSearch: panel === 'blocking' ? state.blockingSearch : '' });
    },
    setDynamicDraft: (dynamicDraft: string) => patch({ dynamicDraft }),
    setBlockingSearch: (blockingSearch: string) => patch({ blockingSearch: blockingSearch.slice(0, 512) }),
    updateBlockingLog(clear = false) {
      const tabId = state.browser.activeTabId;
      if (tabId) send({ type: clear ? 'blocking.clear' : 'blocking.refresh', tabId });
    },
    dismissError: () => patch({ error: null }),
    async close() {
      if (disposed) return;
      clearTimeout(paletteTimer);
      disposed = true;
      resolveReady();
      unsubscribe?.();
      await Effect.runPromise(owner.close());
    },
  };
}
export type ShellController = ReturnType<typeof createController>;
