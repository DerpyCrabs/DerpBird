import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import { decodeSnapshot, navigationTarget, type ScriptCommand, type BrowserPage, type BrowserSnapshot, type Command, type NativePort } from './protocol';
export type Panel = 'menu' | 'blocking' | null;
export interface ShellModel {
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
      const activeChanged = next.activeTabId !== state.browser.activeTabId;
      const navigationArrived = pendingNavigation && next.tabs.some(tab => tab.id === pendingNavigation!.tabId && tab.url !== pendingNavigation!.previousURL);
      if (activeChanged || navigationArrived) {
        pendingNavigation = null;
      }
      patch({ ...(activeChanged || navigationArrived ? { addressInput: null, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 } : {}), ...next.preferences, ...(state.sidebarResizeWidth === next.preferences.sidebarWidth ? { sidebarResizeWidth: null } : {}), browser: { ...next, tabs, addressSuggestions: next.addressSuggestions?.query === state.addressQuery ? next.addressSuggestions : state.browser.addressSuggestions }, connected: true, error: null, tabMenu: state.tabMenu && tabs.some(tab => tab.id === state.tabMenu!.tabId) ? state.tabMenu : null });
    } catch (error) { report(error); }
  };
  const send = (command: Command) => {
    if (disposed) return;
    if (!port || !state.connected) { report(new Error('Browser connection unavailable')); return; }
    const replacePending = command.type === 'shell.viewport' || command.type === 'browser.suggest';
    const lane = command.type === 'shell.viewport' ? 'viewport' : command.type === 'browser.suggest' ? 'autocomplete' : 'command';
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
    source: owner.source,
    reportError: report,
    state: () => state,
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
    blurAddress() {
      patch({ addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 });
    },
    focusAddress(input: string) {
      if (state.addressInput === null) patch({ addressInput: input });
    },
    editAddress(input: string) {
      pendingNavigation = null;
      const query = state.addressQuery + 1;
      patch({ addressInput: input, addressSuggestionsOpen: !!input.trim(), addressQuery: query, addressSelection: -1,
        // Keep a visible list stable during a new query, but never reopen old results.
        ...(!state.addressSuggestionsOpen ? { browser: { ...state.browser, addressSuggestions: undefined } } : {}) });
      // Local history must not wait for the engine's separate remote-search debounce.
      send({ type: 'browser.suggest', input: input.slice(0, 4096), query });
    },
    selectAddress(direction: number) {
      const suggestions = state.browser.addressSuggestions;
      if (!suggestions?.items.length) return;
      patch({ addressSelection: (state.addressSelection + direction + suggestions.items.length) % suggestions.items.length });
    },
    dismissAddress() { pendingNavigation = null; patch({ addressInput: null, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 }); },
    navigate(input: string) {
      if (!input.trim()) return;
      try {
        const url = navigationTarget(input);
        const tabId = state.browser.activeTabId;
        pendingNavigation = tabId ? { tabId, previousURL: state.browser.tabs.find(tab => tab.id === tabId)?.url ?? '' } : null;
        send(tabId ? { type: 'tab.navigate-input', tabId, url: input } : { type: 'tab.create', url, private: false });
        patch({ addressInput: input, addressSuggestionsOpen: false, addressSelection: -1, addressQuery: state.addressQuery + 1 });
      } catch (error) { report(error); }
    },
    setLayout: (layout: ShellModel['layout']) => state.connected ? send({ type: 'shell.set-layout', layout }) : patch({ layout }),
    setPanel(panel: Panel) {
      if (panel === 'blocking' || state.panel === 'blocking') send({ type: 'blocking.log', visible: panel === 'blocking' });
      patch({ panel, dynamicDraft: panel === 'blocking' ? state.dynamicDraft : null, tabMenu: null, blockingSearch: panel === 'blocking' ? state.blockingSearch : '' });
      if (panel === 'menu' && typeof window !== 'undefined') window.requestAnimationFrame(() => { if (state.panel === 'menu') document.querySelector<HTMLButtonElement>('.browser-menu button:not(:disabled)')?.focus(); });
      if (panel === 'blocking' && typeof window !== 'undefined') window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search requests"]')?.focus());
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
      disposed = true;
      resolveReady();
      unsubscribe?.();
      await Effect.runPromise(owner.close());
    },
  };
}
export type ShellController = ReturnType<typeof createController>;
