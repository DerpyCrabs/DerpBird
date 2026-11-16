import { focusAddress } from './browser/address-focus';
import { observeSplitInteractions } from './browser/splits';
import { observeShellDismissal } from './browser/shell-interaction';
import { openPageSources } from './ui/PageSources';
import type { PageSourcesPort, SourceKind } from './browser/page-sources';
import { openProxyManager } from './ui/ProxyManager';
import type { ProxyPort } from './browser/proxy-protocol';
import type { ImportPort } from './browser/import-protocol';
import { openImportManager } from './ui/ImportManager';
import { observeSidebarResize } from './browser/sidebar-resize';
import { checkSourceUpdates } from './browser/source-updates';
import { syncScriptFolders, syncStyleFolders } from './browser/source-folder-sync';
import { observeActiveTab } from './browser/tab-visibility';
import { openCredentialManager } from './ui/CredentialManager';
import type { CapturedCredential, CredentialPort } from './browser/credential-protocol';
import { observeViewport } from './browser/viewport';
import { mount } from 'effectweb';
import { createWebUIPort, type WebUIChannel } from './browser/webui-port';
import { createController } from './browser/controller';
import type { NativePort } from './browser/protocol';
import { shellView } from './ui/Shell';
import './style.css';
import { openScriptManager } from './ui/ScriptManager';
import type { UserScriptPort } from './browser/script-protocol';
import { openStyleManager } from './ui/StyleManager';
import type { UserStylePort } from './browser/style-protocol';

declare global { interface Window { derpbird?: NativePort; ladybird?: WebUIChannel } }
const webui = location.href === 'about:derpbird' ? createWebUIPort(document, () => window.ladybird) : undefined;
const controller = createController(window.derpbird ?? webui);
const stylePort = (window.derpbird as (NativePort & { styles?: UserStylePort }) | undefined)?.styles ?? webui?.styles;
const scriptPort = (window.derpbird as (NativePort & { scripts?: UserScriptPort }) | undefined)?.scripts ?? webui?.scripts;
const credentialPort = (window.derpbird as (NativePort & { credentials?: CredentialPort }) | undefined)?.credentials ?? webui?.credentials;
const importPort = (window.derpbird as (NativePort & { importer?: ImportPort }) | undefined)?.importer ?? webui?.importer;
const proxyPort = (window.derpbird as (NativePort & { proxy?: ProxyPort }) | undefined)?.proxy ?? webui?.proxy;
let pageSourcePopup: ReturnType<typeof openPageSources> | undefined;
let proxyManager: ReturnType<typeof openProxyManager> | undefined;
let importManager: ReturnType<typeof openImportManager> | undefined;
let credentialManager: ReturnType<typeof openCredentialManager> | undefined;
let scriptManager: ReturnType<typeof openScriptManager> | undefined;
let backgroundSources: AbortController | undefined;
let styleManager: ReturnType<typeof openStyleManager> | undefined;
const showStyles = stylePort ? () => {
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  if (backgroundSources) { foldersPending = true; backgroundSources.abort(); }
  styleManager = openStyleManager(document.getElementById('style-manager-host')!, stylePort, () => {
    styleManager = undefined;
    void refreshPageSources();
    if (foldersPending) { foldersPending = false; void syncFolders(); }
  });
} : undefined;
const showScripts = scriptPort ? () => {
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  if (backgroundSources) { foldersPending = true; backgroundSources.abort(); }
  scriptManager = openScriptManager(document.getElementById('style-manager-host')!, scriptPort, () => {
    scriptManager = undefined;
    void refreshPageSources();
    if (foldersPending) { foldersPending = false; void syncFolders(); }
  });
} : undefined;
const showCredentials = credentialPort ? (proposal?: CapturedCredential) => {
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  credentialManager = openCredentialManager(document.getElementById('style-manager-host')!, credentialPort, () => {
    credentialManager = undefined;
  }, proposal);
} : undefined;
const showImport = importPort ? (welcome = false) => {
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  importManager = openImportManager(document.getElementById('style-manager-host')!, importPort, () => {
    importManager = undefined;
  }, welcome);
} : undefined;
const showProxy = proxyPort ? () => {
  if (proxyManager) { proxyManager.toggle(); return; }
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  const browser = controller.state().browser;
  proxyManager = openProxyManager(document.getElementById('style-manager-host')!, proxyPort, () => {
    proxyManager = undefined;
  }, browser.tabs.find(tab => tab.id === browser.activeTabId)?.url);
} : undefined;
const pageSourcesPort = (window.derpbird as (NativePort & { pageSources?: PageSourcesPort }) | undefined)?.pageSources ?? webui?.pageSources;
let sourceRequest = 0;
const refreshPageSources = async () => {
  const request = ++sourceRequest, browser = controller.state().browser;
  const active = browser.tabs.find(tab => tab.id === browser.activeTabId);
  if (!pageSourcesPort || !active || active.private) { controller.setPageSources(); return; }
  try {
    const page = await pageSourcesPort.page();
    const current = controller.state().browser;
    if (request === sourceRequest && page.tabId === current.activeTabId && current.tabs.find(t => t.id === page.tabId)?.url === page.url) controller.setPageSources(page);
  } catch { if (request === sourceRequest) controller.setPageSources(); }
};
const showPageSources = pageSourcesPort ? (kind: SourceKind) => {
  if (pageSourcePopup) { pageSourcePopup.close(); return; }
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager) return;
  const tabId = controller.state().browser.activeTabId;
  pageSourcePopup = openPageSources(document.getElementById('style-manager-host')!, pageSourcesPort, kind,
    () => { pageSourcePopup = undefined; },
    page => controller.setPageSources(page), () => kind === 'styles' ? showStyles?.() : showScripts?.(),
    () => { if (tabId && controller.state().browser.activeTabId === tabId) controller.send({ type: 'tab.reload', tabId }); });
} : undefined;
let lastSourcePage = '';
const stopPageSources = pageSourcesPort ? (window.derpbird ?? webui)?.subscribe(() => {
  const browser = controller.state().browser, active = browser.tabs.find(t => t.id === browser.activeTabId);
  const key = `${active?.id}:${active?.url}:${active?.loading}`;
  if (key === lastSourcePage) return;
  lastSourcePage = key;
  pageSourcePopup?.dispose(); pageSourcePopup = undefined;
  controller.setPageSources(); void refreshPageSources();
}) : undefined;
void controller.ready.then(refreshPageSources);
if (importPort) void controller.ready.then(async () => {
  if (controller.state().browser.tabs.some(tab => tab.private)) return;
  const status = await importPort.status();
  if (status.welcome) showImport?.(true);
}).catch(error => controller.reportError(error));
let syncingFolders = false;
let foldersPending = false;
let foldersDisposed = false;
const syncFolders = async () => {
  if (foldersDisposed) return;
  if (syncingFolders) { foldersPending = true; return; }
  // An editor owns the visible draft; refresh once it closes.
  if (styleManager || scriptManager) { foldersPending = true; return; }
  syncingFolders = true;
  const operation = new AbortController();
  backgroundSources = operation;
  try {
    await controller.ready;
    const canContinue = () => !operation.signal.aborted && !foldersDisposed && !styleManager && !scriptManager
      && controller.state().connected && !controller.state().browser.tabs.some(tab => tab.private);
    if (!canContinue()) return;
    // A missing script directory must not stop style refreshes (or vice versa).
    // Keep registry writes sequential and respect editor ownership between jobs.
    const failures: string[] = [];
    const refresh = async (work: () => Promise<void>) => {
      if (!canContinue()) return;
      try { await work(); }
      catch (error) {
        // A native load-start cancellation can precede pagehide. Revoke the
        // entire batch so its next source kind cannot start on the old shell.
        if (error instanceof Error && error.name === 'AbortError') operation.abort();
        else failures.push(error instanceof Error ? error.message : String(error));
      }
    };
    if (scriptPort) await refresh(() => syncScriptFolders(scriptPort, canContinue));
    if (stylePort) await refresh(() => syncStyleFolders(stylePort, canContinue, operation.signal));
    if (scriptPort) await refresh(() => checkSourceUpdates(scriptPort, true, Date.now(), canContinue, operation.signal));
    if (stylePort) await refresh(() => checkSourceUpdates(stylePort, false, Date.now(), canContinue, operation.signal));
    if (failures.length && canContinue()) controller.reportError(new Error([...new Set(failures)].join('\n')));
  } catch (error) { controller.reportError(error); }
  finally {
    if (backgroundSources === operation) backgroundSources = undefined;
    syncingFolders = false;
    void refreshPageSources();
    if (foldersPending && !styleManager && !scriptManager) { foldersPending = false; void syncFolders(); }
  }
};
const stopSourceChanges = webui?.onSourceChange(() => { void syncFolders(); void refreshPageSources(); });
if (webui) void syncFolders();
const updateTimer = webui ? setInterval(() => { void syncFolders(); }, 3_600_000) : undefined;
const autofillPort = (window.derpbird as (NativePort & { autofill?: (token: string, id?: string) => Promise<void> }) | undefined)?.autofill ?? webui?.autofill;
const autofill = autofillPort ? (token: string, id?: string) => { void autofillPort(token, id).catch(error => controller.reportError(error)); } : undefined;
const mounted = mount(document.getElementById('app')!, shellView(controller, showStyles, showScripts, showCredentials, showImport, autofill, showProxy, showPageSources), controller.source);
const stopSplitInteractions = observeSplitInteractions(document, controller);
const stopSidebarResize = observeSidebarResize(document, controller.previewSidebarWidth, controller.setSidebarWidth);
const stopActiveTab = observeActiveTab(document);
const stopViewport = observeViewport(document, command => controller.send(command), () => controller.state().connected);
const onKey = (event: KeyboardEvent) => {
  if (styleManager || scriptManager || credentialManager || importManager || proxyManager || pageSourcePopup) return;
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'r' && !event.shiftKey && controller.state().browser.activeTabId) { event.preventDefault(); controller.send({ type: 'tab.reload', tabId: controller.state().browser.activeTabId! }); }
  if (key === 'h' && !event.shiftKey) { event.preventDefault(); controller.openPage('history'); }
  if (key === 'j' && !event.shiftKey) { event.preventDefault(); controller.openPage('downloads'); }
  if (key === 'l') { event.preventDefault(); focusAddress(document, controller); }
  if (key === 't') { event.preventDefault(); controller.send(event.shiftKey ? { type: 'tab.reopen' } : { type: 'tab.create', private: controller.state().browser.tabs.find(tab => tab.id === controller.state().browser.activeTabId)?.private ?? false }); }
  if (key === 'w' && controller.state().browser.activeTabId) { event.preventDefault(); controller.send({ type: 'tab.close', tabId: controller.state().browser.activeTabId! }); }
  if (key === 'n') { event.preventDefault(); controller.send({ type: 'window.new', private: event.shiftKey }); }
};
const stopShellDismissal = observeShellDismissal({ deactivate: () => controller.blurAddress() });
const onFocusAddress = () => focusAddress(document, controller);
window.addEventListener('derpbird-focus-address', onFocusAddress);
document.addEventListener('keydown', onKey);
window.addEventListener('pagehide', () => {
  foldersDisposed = true;
  backgroundSources?.abort();
  clearInterval(updateTimer);
  stopSourceChanges?.();
  window.removeEventListener('derpbird-focus-address', onFocusAddress);
  document.removeEventListener('keydown', onKey);
  stopShellDismissal();
  stopViewport();
  stopActiveTab();
  stopSplitInteractions(); stopSidebarResize();
  styleManager?.dispose();
  scriptManager?.dispose();
  credentialManager?.dispose();
  importManager?.dispose();
  proxyManager?.dispose();
  pageSourcePopup?.dispose(); stopPageSources?.(); ++sourceRequest;
  mounted.dispose();
  webui?.close();
  void controller.close();
}, { once: true });
