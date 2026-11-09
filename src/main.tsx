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
let importManager: ReturnType<typeof openImportManager> | undefined;
let credentialManager: ReturnType<typeof openCredentialManager> | undefined;
let scriptManager: ReturnType<typeof openScriptManager> | undefined;
let backgroundSources: AbortController | undefined;
let styleManager: ReturnType<typeof openStyleManager> | undefined;
const showStyles = stylePort ? () => {
  if (styleManager || scriptManager || credentialManager || importManager) return;
  if (backgroundSources) { foldersPending = true; backgroundSources.abort(); }
  styleManager = openStyleManager(document.getElementById('style-manager-host')!, stylePort, () => {
    styleManager = undefined;
    if (foldersPending) { foldersPending = false; void syncFolders(); }
    document.querySelector<HTMLElement>('[aria-label="Menu"]')?.focus();
  });
} : undefined;
const showScripts = scriptPort ? () => {
  if (styleManager || scriptManager || credentialManager || importManager) return;
  if (backgroundSources) { foldersPending = true; backgroundSources.abort(); }
  scriptManager = openScriptManager(document.getElementById('style-manager-host')!, scriptPort, () => {
    scriptManager = undefined;
    if (foldersPending) { foldersPending = false; void syncFolders(); }
    document.querySelector<HTMLElement>('[aria-label="Menu"]')?.focus();
  });
} : undefined;
const showCredentials = credentialPort ? (proposal?: CapturedCredential) => {
  if (styleManager || scriptManager || credentialManager || importManager) return;
  credentialManager = openCredentialManager(document.getElementById('style-manager-host')!, credentialPort, () => {
    credentialManager = undefined;
    document.querySelector<HTMLElement>('[aria-label="Menu"]')?.focus();
  }, proposal);
} : undefined;
const showImport = importPort ? (welcome = false) => {
  if (styleManager || scriptManager || credentialManager || importManager) return;
  importManager = openImportManager(document.getElementById('style-manager-host')!, importPort, () => {
    importManager = undefined;
    document.querySelector<HTMLElement>('[aria-label="Menu"]')?.focus();
  }, welcome);
} : undefined;
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
    if (foldersPending && !styleManager && !scriptManager) { foldersPending = false; void syncFolders(); }
  }
};
const stopSourceChanges = webui?.onSourceChange(() => { void syncFolders(); });
if (webui) void syncFolders();
const updateTimer = webui ? setInterval(() => { void syncFolders(); }, 3_600_000) : undefined;
const autofillPort = (window.derpbird as (NativePort & { autofill?: (token: string, id?: string) => Promise<void> }) | undefined)?.autofill ?? webui?.autofill;
const autofill = autofillPort ? (token: string, id?: string) => { void autofillPort(token, id).catch(error => controller.reportError(error)); } : undefined;
const mounted = mount(document.getElementById('app')!, shellView(controller, showStyles, showScripts, showCredentials, showImport, autofill), controller.source);
const stopSidebarResize = observeSidebarResize(document, controller.previewSidebarWidth, controller.setSidebarWidth);
const stopActiveTab = observeActiveTab(document);
const stopViewport = observeViewport(document, command => controller.send(command), () => controller.state().connected);
const onKey = (event: KeyboardEvent) => {
  if (styleManager || scriptManager || credentialManager || importManager) return;
  if (event.key === 'Escape') {
    const tabId = controller.state().tabMenu?.tabId;
    const hadPanel = !!controller.state().panel;
    controller.setPanel(null); controller.closeTabMenu();
    if (tabId) window.requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(tab => tab.dataset.tabId === tabId)?.focus();
    });
    else if (hadPanel) document.querySelector<HTMLButtonElement>('[aria-label="Menu"]')?.focus();
    return;
  }
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'r' && !event.shiftKey && controller.state().browser.activeTabId) { event.preventDefault(); controller.send({ type: 'tab.reload', tabId: controller.state().browser.activeTabId! }); }
  if (key === 'h' && !event.shiftKey) { event.preventDefault(); controller.openPage('history'); }
  if (key === 'j' && !event.shiftKey) { event.preventDefault(); controller.openPage('downloads'); }
  if (key === 'l') { event.preventDefault(); (document.getElementById('location') as HTMLInputElement)?.select(); }
  if (key === 't') { event.preventDefault(); controller.send(event.shiftKey ? { type: 'tab.reopen' } : { type: 'tab.create', private: controller.state().browser.tabs.find(tab => tab.id === controller.state().browser.activeTabId)?.private ?? false }); }
  if (key === 'w' && controller.state().browser.activeTabId) { event.preventDefault(); controller.send({ type: 'tab.close', tabId: controller.state().browser.activeTabId! }); }
  if (key === 'n') { event.preventDefault(); controller.send({ type: 'window.new', private: event.shiftKey }); }
};
const onOutsidePointer = (event: PointerEvent) => {
  if (event.target instanceof Element && !event.target.closest('.credential-autofill') && controller.state().browser.credentialAutofill) autofill?.(controller.state().browser.credentialAutofill!.token);
  if (!(event.target instanceof Element) || event.target.closest('.tab-menu, .browser-menu, .blocking-log, [aria-label="Menu"]')) return;
  if (!event.target.closest('.address')) controller.dismissAddress();
  if (controller.state().panel) controller.setPanel(null);
  if (controller.state().tabMenu) controller.closeTabMenu();
};
const onShellBlur = () => {
  const address = document.getElementById('location') as HTMLInputElement | null;
  if (document.activeElement === address) address?.blur();
  controller.blurAddress();
  if (controller.state().panel) controller.setPanel(null);
  if (controller.state().tabMenu) controller.closeTabMenu();
};
window.addEventListener('blur', onShellBlur);
document.addEventListener('pointerdown', onOutsidePointer);
document.addEventListener('keydown', onKey);
window.addEventListener('pagehide', () => {
  foldersDisposed = true;
  backgroundSources?.abort();
  clearInterval(updateTimer);
  stopSourceChanges?.();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onOutsidePointer);
  stopViewport();
  stopActiveTab();
  stopSidebarResize();
  window.removeEventListener('blur', onShellBlur);
  styleManager?.dispose();
  scriptManager?.dispose();
  credentialManager?.dispose();
  importManager?.dispose();
  mounted.dispose();
  webui?.close();
  void controller.close();
}, { once: true });
