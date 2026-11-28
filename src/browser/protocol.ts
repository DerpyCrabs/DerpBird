import { decodeWorkspaces, type Workspaces, type WorkspaceDraft } from './workspaces';
import { decodeChromeLayout, type ChromeLayout } from './chrome-layout';
import { decodeCapturedCredential, decodeCredential, type Credential, type CapturedCredential } from './credential-protocol';
export const protocolVersion = 1 as const;
export interface Tab {
  readonly blankNewTab?: boolean;
  readonly parentId?: string;
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly pinned: boolean;
  readonly audible: boolean;
  readonly muted: boolean;
  readonly attention?: boolean;
  readonly zoom?: number;
  readonly favicon?: string;
  readonly private: boolean;
}
export function isNewTabPage(tab?: Tab) {
  return tab?.url === 'about:newtab' || (tab?.url === 'about:blank' && tab.blankNewTab === true);
}

export interface ShellPreferences { readonly theme?: 'dark' | 'light'; readonly alwaysClose?: boolean; readonly chromeLayout?: ChromeLayout; readonly sidebarWidth?: number; readonly wrapTabs?: boolean; readonly layout: 'vertical' | 'horizontal' }
export interface ScriptCommand { readonly id: string; readonly script: string; readonly label: string; readonly title: string; readonly accessKey: string; readonly autoClose: boolean }
export interface ScriptCommandEvent { readonly keyboard: boolean; readonly key: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean; readonly metaKey: boolean }
export interface BlockingLog { readonly tabId: string; readonly entries: readonly { readonly id: number; readonly url: string; readonly kind: string; readonly rule?: string }[] }
export interface CredentialAutofill { readonly token: string; readonly origin: string; readonly x: number; readonly y: number; readonly items: readonly Credential[] }
export interface SplitView { readonly id: string; readonly firstTabId: string; readonly secondTabId: string; readonly axis: 'horizontal' | 'vertical'; readonly ratio: number }
export interface BrowserDownload {
  thumbnail?: string;
  id: string; name: string; path: string; received: number; total?: number; startedAt?: number; finishedAt?: number; resumable: boolean;
  status: 'Downloading' | 'Paused' | 'Finished' | 'Canceled' | 'Failed';
}
export interface ShellDialog {
  id: string; kind: string; title: string; message: string; value: string; action: string; offerBlock?: boolean;
  folders?: readonly { name: string; id: string }[]; folder?: string; url?: string; removable?: boolean; once?: boolean;
  processes?: readonly {id:number; pid:number; name:string; cpu:number; bytes:number; canEnd:boolean; pages:readonly string[]}[];
  minimum?: string; maximum?: string;
}
export interface BrowserSnapshot {
  readonly dialog?: ShellDialog;
  readonly downloads?: readonly BrowserDownload[];
  readonly automation?: { readonly enabled: boolean; readonly clients: number; readonly endpoint: string };
  readonly workspaces?: Workspaces;
  readonly splits?: readonly SplitView[];
  readonly proxyProfile?: string;
  readonly credentialAutofill?: CredentialAutofill | null;
  readonly addressSuggestions?: { readonly query: number; readonly items: readonly { readonly text: string; readonly title: string; readonly source?: 'search' | 'history' | 'bookmark' | 'page' | 'settings'; readonly subtitle?: string; readonly favicon?: string }[] };
  readonly dynamicRules?: string;
  readonly filterProposal?: { readonly tabId: string; readonly url: string; readonly rule: string };
  readonly blockingLog?: BlockingLog;
  readonly scriptCommands?: readonly ScriptCommand[];
  readonly credentialProposal?: CapturedCredential | null;
  readonly version: typeof protocolVersion;
  readonly revision: number;
  readonly preferences: ShellPreferences;
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
}
export type BrowserPage = 'history' | 'downloads' | 'bookmarks' | 'settings';
export interface SurfaceRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type Command =
  | { readonly type: 'dialog.edit'; readonly id: string; readonly value: string }
  | { readonly type: 'dialog.answer'; readonly id: string; readonly accepted: boolean; readonly value: string; readonly block: boolean }
  | { readonly type: 'download.action'; readonly action: 'clear' | 'cancel' | 'pause' | 'resume' | 'open' | 'reveal' | 'thumbnail' | 'drag'; readonly id?: string }
  | { readonly type: 'automation.set-enabled'; readonly enabled: boolean }
  | { readonly type: 'workspace.move-tab'; readonly id: string; readonly tabId: string }
  | { readonly type: 'workspace.switch'; readonly id: string }
  | ({ readonly type: 'workspace.create' | 'workspace.update' } & WorkspaceDraft)
  | { readonly type: 'browser.suggest'; readonly input: string; readonly query: number }
  | { readonly type: 'blocking.dynamic-save'; readonly rules: string }
  | { readonly type: 'blocking.pick' | 'blocking.zap' | 'blocking.picker-cancel'; readonly tabId: string }
  | { readonly type: 'blocking.picker-save'; readonly tabId: string; readonly rule: string }
  | { readonly type: 'blocking.log'; readonly visible: boolean }
  | { readonly type: 'blocking.refresh' | 'blocking.clear'; readonly tabId: string }
  | { readonly type: 'script.command'; readonly tabId: string; readonly id: string; readonly event: ScriptCommandEvent }
  | { readonly type: 'shell.set-always-close'; readonly alwaysClose: boolean }
  | { readonly type: 'shell.set-appearance'; readonly theme: 'dark' | 'light'; readonly alwaysClose: boolean }
  | { readonly type: 'shell.set-chrome-layout'; readonly layout: ChromeLayout }
  | { readonly type: 'shell.set-layout'; readonly layout: ShellPreferences['layout'] }
  | { readonly type: 'shell.set-sidebar-width'; readonly width: number }
  | { readonly type: 'shell.set-wrap-tabs'; readonly value: boolean }
  | { readonly type: 'browser.open-page'; readonly page: BrowserPage }
  | { readonly type: 'shell.viewport'; readonly captureInput?: boolean; readonly rect: SurfaceRect; readonly overlays: readonly SurfaceRect[] }
  | { readonly type: 'tab.create-input'; readonly url: string; readonly private: boolean }
  | { readonly type: 'tab.create' | 'window.new'; readonly url?: string; readonly private: boolean }
  | { readonly type: 'tab.activate'; readonly tabId: string; readonly focus?: 'tab' }
  | { readonly type: 'tab.inspect' | 'tab.close' | 'tab.back' | 'tab.forward' | 'tab.reload' | 'tab.stop' | 'tab.duplicate' | 'tab.close-others' | 'tab.close-right' | 'tab.find' | 'tab.bookmark' | 'tab.site-settings' | 'tab.zoom-in' | 'tab.zoom-out' | 'tab.zoom-reset'; readonly tabId: string }
  | { readonly type: 'tab.navigate' | 'tab.navigate-input'; readonly tabId: string; readonly url: string }
  | { readonly type: 'tab.pin' | 'tab.mute'; readonly tabId: string; readonly value: boolean }
  | { readonly type: 'tab.split'; readonly tabId: string; readonly targetId: string; readonly edge: 'left' | 'right' | 'top' | 'bottom' }
  | { readonly type: 'split.switch'; readonly tabId: string }
  | { readonly type: 'split.resize'; readonly tabId: string; readonly ratio: number }
  | { readonly type: 'tab.tree-move'; readonly tabId: string; readonly targetId: string; readonly placement: 'before' | 'inside' | 'after' }
  | { readonly type: 'tab.new-child' | 'tab.ungroup' | 'tab.close-group'; readonly tabId: string }
  | { readonly type: 'tab.move'; readonly tabId: string; readonly index: number }
  | { readonly type: 'tab.reopen' }
  | { readonly type: 'window.minimize' | 'window.maximize' | 'window.close' };
export interface NativePort {
  readonly version: typeof protocolVersion;
  request(command: Command): Promise<void>;
  snapshot(): Promise<unknown>;
  subscribe(listener: (snapshot: unknown) => void): () => void;
}

export function decodeSnapshot(value: unknown): BrowserSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser snapshot');
  const s = value as Record<string, unknown>;
  if (s.version !== protocolVersion || !Number.isSafeInteger(s.revision) || (s.revision as number) < 0 || !Array.isArray(s.tabs))
    throw new Error('Unsupported browser snapshot');
  const prefs = s.preferences as Record<string, unknown> | undefined;
  if (!prefs || !['vertical', 'horizontal'].includes(prefs.layout as string))
    throw new Error('Invalid shell preferences');
  if (prefs.sidebarWidth !== undefined && (!Number.isInteger(prefs.sidebarWidth) || (prefs.sidebarWidth as number) < 120 || (prefs.sidebarWidth as number) > 600)) throw new Error('Invalid sidebar width');
  if (prefs.wrapTabs !== undefined && typeof prefs.wrapTabs !== 'boolean') throw new Error('Invalid tab wrapping preference');
  if (prefs.theme !== undefined && !['dark','light'].includes(prefs.theme as string)) throw new Error('Invalid theme');
  if (prefs.alwaysClose !== undefined && typeof prefs.alwaysClose !== 'boolean') throw new Error('Invalid close button preference');
  const preferences: ShellPreferences = Object.freeze({ ...(prefs.theme === undefined ? {} : {theme:prefs.theme as 'dark'|'light'}), ...(prefs.alwaysClose === undefined ? {} : {alwaysClose:prefs.alwaysClose as boolean}), ...(prefs.chromeLayout === undefined ? {} : { chromeLayout: decodeChromeLayout(prefs.chromeLayout) }), ...(prefs.sidebarWidth === undefined ? {} : { sidebarWidth: prefs.sidebarWidth as number }), ...(prefs.wrapTabs === undefined ? {} : { wrapTabs: prefs.wrapTabs as boolean }), layout: prefs.layout as ShellPreferences['layout'] });
  const ids = new Set<string>();
  const tabs: Tab[] = s.tabs.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid tab');
    const t = item as Record<string, unknown>;
    if (typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.url !== 'string' || typeof t.title !== 'string')
      throw new Error('Invalid tab identity');
    ids.add(t.id);
    for (const key of ['loading', 'canGoBack', 'canGoForward', 'pinned', 'audible', 'muted', 'private'])
      if (typeof t[key] !== 'boolean') throw new Error(`Invalid tab ${key}`);
    if (t.favicon !== undefined && (typeof t.favicon !== 'string' || t.favicon.length > 16384 || (t.favicon !== '' && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(t.favicon)))) throw new Error('Invalid favicon');
    if (t.zoom !== undefined && (typeof t.zoom !== 'number' || !Number.isFinite(t.zoom) || t.zoom <= 0 || t.zoom > 10)) throw new Error('Invalid tab zoom');
    if (t.parentId !== undefined && (typeof t.parentId !== 'string' || !t.parentId)) throw new Error('Invalid tab parent');
    return Object.freeze({ ...(t.blankNewTab === true ? {blankNewTab:true} : {}), ...(t.parentId === undefined ? {} : { parentId: t.parentId }), favicon: t.favicon ?? '', zoom: t.zoom ?? 1, id: t.id, url: t.url, title: t.title, loading: t.loading, canGoBack: t.canGoBack,
      canGoForward: t.canGoForward, pinned: t.pinned, audible: t.audible, muted: t.muted, attention: t.attention === true, private: t.private }) as Tab;
  });
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  let currentRoot: string | undefined;
  for (const tab of tabs) {
    if (!tab.parentId) { currentRoot = tab.id; continue; }
    const parent = byId.get(tab.parentId);
    if (!parent || parent.id === tab.id || parent.parentId || parent.pinned || tab.pinned || parent.private !== tab.private || currentRoot !== parent.id)
      throw new Error('Invalid tab tree');
  }
  if (!(s.activeTabId === null && tabs.length === 0) && !(typeof s.activeTabId === 'string' && ids.has(s.activeTabId)))
    throw new Error('Invalid active tab');
  const rawSplits = s.splits ?? [];
  if (!Array.isArray(rawSplits)) throw new Error('Invalid split views');
  const splitTabs = new Set<string>(), splitIds = new Set<string>();
  const splits: SplitView[] = rawSplits.map((value: unknown) => {
    const split = value as SplitView;
    if (!split || typeof split.id !== 'string' || !split.id || splitIds.has(split.id)
      || !ids.has(split.firstTabId) || !ids.has(split.secondTabId) || split.firstTabId === split.secondTabId
      || splitTabs.has(split.firstTabId) || splitTabs.has(split.secondTabId)
      || !['horizontal', 'vertical'].includes(split.axis) || !Number.isFinite(split.ratio) || split.ratio < .2 || split.ratio > .8)
      throw new Error('Invalid split view');
    const first = byId.get(split.firstTabId)!, second = byId.get(split.secondTabId)!;
    if (first.private !== second.private || first.pinned || second.pinned) throw new Error('Invalid split members');
    splitIds.add(split.id); splitTabs.add(first.id); splitTabs.add(second.id);
    return Object.freeze({id:split.id,firstTabId:first.id,secondTabId:second.id,axis:split.axis,ratio:split.ratio});
  });
  const rawCommands = s.scriptCommands ?? [];
  if (!Array.isArray(rawCommands) || rawCommands.length > 256) throw new Error('Invalid script commands');
  const commandIds = new Set<string>();
  const scriptCommands = rawCommands.map((command: unknown): ScriptCommand => {
    if (!command || typeof command !== 'object') throw new Error('Invalid script command');
    const c = command as Record<string, unknown>;
    for (const [key, limit] of [['id',128],['script',1024],['label',512],['title',1024],['accessKey',16]] as const)
      if (typeof c[key] !== 'string' || (c[key] as string).length > limit) throw new Error('Invalid script command');
    if (!c.id || commandIds.has(c.id as string) || !c.label || typeof c.autoClose !== 'boolean') throw new Error('Invalid script command');
    commandIds.add(c.id as string);
    return Object.freeze({ id:c.id as string, script:c.script as string, label:c.label as string, title:c.title as string, accessKey:c.accessKey as string, autoClose:c.autoClose });
  });
  let blockingLog: BlockingLog | undefined;
  if (s.blockingLog != null) {
    const log = s.blockingLog as Record<string, unknown>;
    if (!log || typeof log !== 'object' || log.tabId !== s.activeTabId || !Array.isArray(log.entries) || log.entries.length > 128)
      throw new Error('Invalid blocking log');
    let previousId = 0;
    const entries = log.entries.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid blocking event');
      const row = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(row.id) || (row.id as number) <= previousId || typeof row.url !== 'string' || row.url.length > 2052 || typeof row.kind !== 'string' || row.kind.length > 64)
        throw new Error('Invalid blocking event');
      if (row.rule !== undefined && (typeof row.rule !== 'string' || row.rule.length > 4096)) throw new Error('Invalid blocking rule');
      previousId = row.id as number;
      return Object.freeze({ id: row.id as number, url: row.url, kind: row.kind, ...(row.rule === undefined ? {} : { rule: row.rule as string }) });
    });
    blockingLog = Object.freeze({ tabId: log.tabId as string, entries: Object.freeze(entries) });
  }
  if (s.dynamicRules !== undefined && (typeof s.dynamicRules !== 'string' || s.dynamicRules.length > 65536)) throw new Error('Invalid dynamic rules');
  let addressSuggestions: BrowserSnapshot['addressSuggestions'];
  if (s.addressSuggestions != null) {
    const suggestions = s.addressSuggestions as NonNullable<BrowserSnapshot['addressSuggestions']>;
    if (!Number.isSafeInteger(suggestions.query) || !Array.isArray(suggestions.items) || suggestions.items.length > 8 || suggestions.items.some(item => !item || typeof item.text !== 'string' || typeof item.title !== 'string' || item.text.length > 8192 || item.title.length > 8192 || (item.source !== undefined && !['search', 'history', 'bookmark', 'page', 'settings'].includes(item.source)) || (item.subtitle !== undefined && (typeof item.subtitle !== 'string' || item.subtitle.length > 8192)) || (item.favicon !== undefined && (typeof item.favicon !== 'string' || item.favicon.length > 16384 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.favicon))))) throw new Error('Invalid address suggestions');
    addressSuggestions = suggestions;
  }
  let dialog: ShellDialog | undefined;
  if (s.dialog != null) {
    const d = s.dialog as ShellDialog;
    if (![d.id, d.kind, d.title, d.message, d.value, d.action].every(v => typeof v === 'string'))
      throw new Error('Invalid shell dialog');
    dialog = { ...d, id: d.id, kind: d.kind, title: d.title, message: d.message, value: d.value, action: d.action, offerBlock: d.offerBlock === true };
  }
  let filterProposal: BrowserSnapshot['filterProposal'];
  if (s.filterProposal != null) {
    const p = s.filterProposal as Record<string, unknown>;
    if (!p || typeof p.tabId !== 'string' || !ids.has(p.tabId) || typeof p.url !== 'string' || typeof p.rule !== 'string' || p.rule.length > 8192) throw new Error('Invalid filter proposal');
    filterProposal = Object.freeze({ tabId: p.tabId, url: p.url, rule: p.rule });
  }
  let credentialAutofill: CredentialAutofill | null = null;
  if (s.credentialAutofill != null) {
    const a = s.credentialAutofill as Record<string, unknown>;
    if (typeof a.token !== 'string' || !/^\d{1,20}$/.test(a.token) || typeof a.origin !== 'string'
        || typeof a.x !== 'number' || !Number.isFinite(a.x) || typeof a.y !== 'number' || !Number.isFinite(a.y)
        || !Array.isArray(a.items) || a.items.length > 4096) throw new Error('Invalid login suggestions');
    const items = a.items.map(decodeCredential);
    if (items.some(item => item.origin !== a.origin) || tabs.find(tab => tab.id === s.activeTabId)?.private !== false) throw new Error('Invalid login suggestion origin');
    if (new Set(items.map(item => item.id)).size !== items.length || Object.keys(a).some(key => !['token', 'origin', 'x', 'y', 'items'].includes(key))) throw new Error('Invalid login suggestions');
    credentialAutofill = Object.freeze({ token: a.token, origin: a.origin, x: a.x, y: a.y, items: Object.freeze(items) });
  }
  const credentialProposal = s.credentialProposal == null ? null : decodeCapturedCredential(s.credentialProposal);
  if (credentialProposal && tabs.find(tab => tab.id === s.activeTabId)?.private !== false)
    throw new Error('Credential suggestion requires an ordinary active tab');
  if (s.proxyProfile !== undefined && (typeof s.proxyProfile !== 'string' || s.proxyProfile.length > 256)) throw new Error('Invalid proxy profile');
  let automation: BrowserSnapshot['automation'];
  if (s.automation !== undefined) {
    const a = s.automation as Partial<NonNullable<BrowserSnapshot['automation']>> | null;
    if (!a || typeof a.enabled !== 'boolean' || typeof a.endpoint !== 'string' || !Number.isSafeInteger(a.clients) || a.clients! < 0 || a.clients! > 16)
      throw new Error('Invalid automation state');
    automation = Object.freeze({ enabled: a.enabled, endpoint: a.endpoint, clients: a.clients! });
  }
  const downloads = s.downloads ?? [];
  if (!Array.isArray(downloads) || downloads.some(file => !file || typeof file.id !== 'string' || typeof file.name !== 'string'
    || typeof file.path !== 'string' || !Number.isFinite(file.received) || (file.total !== undefined && !Number.isFinite(file.total))
    || [file.startedAt, file.finishedAt].some(time => time !== undefined && (!Number.isSafeInteger(time) || time <= 0 || time > 8.64e15))
    || typeof file.resumable !== 'boolean' || !['Downloading','Paused','Finished','Canceled','Failed'].includes(file.status)))
    throw new Error('Invalid download snapshot');
  return Object.freeze({ dialog, downloads: Object.freeze(downloads), ...(automation ? { automation } : {}), workspaces: decodeWorkspaces(s.workspaces), splits: Object.freeze(splits), ...(s.proxyProfile === undefined ? {} : { proxyProfile: s.proxyProfile as string }), credentialAutofill, addressSuggestions, dynamicRules: s.dynamicRules as string | undefined, filterProposal, blockingLog, scriptCommands: Object.freeze(scriptCommands), credentialProposal, version: protocolVersion, revision: s.revision as number, preferences, tabs: Object.freeze(tabs), activeTabId: s.activeTabId as string | null });
}

export function navigationTarget(input: string): string {
  const text = input.trim();
  if (!text) return 'about:blank';
  if (text === 'about:blank') return text;
  // Scheme detection precedes host detection so executable URLs cannot become searches.
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^(localhost|[^\s/:]+\.[^\s/:]+):\d+(\/|$)/i.test(text)) {
    const url = new URL(text);
    if (url.protocol === 'about:' && ['blank', 'history', 'downloads', 'bookmarks', 'settings', 'version', 'newtab'].includes(url.pathname)) return url.href;
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('This protocol cannot be opened from the address bar');
    return url.href;
  }
  if (!/\s/.test(text) && /^(localhost(?::\d+)?|\[[\da-f:]+\](?::\d+)?|[^/:]+\.[^/:]+(?::\d+)?)([/?#]|$)/i.test(text)) {
    return new URL(`${/^localhost(?::|\/|$)/.test(text) ? 'http' : 'https'}://${text}`).href;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
