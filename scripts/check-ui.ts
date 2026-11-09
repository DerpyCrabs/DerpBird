import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import type { Command } from '../src/browser/protocol';

const window = new Window({ url: 'http://127.0.0.1/' });
for (const key of ['window', 'document', 'location', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement', 'DOMRect', 'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'ResizeObserver', 'getComputedStyle', 'Element', 'Node', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'CSSStyleDeclaration', 'SVGElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'getComputedStyle' ? window.getComputedStyle.bind(window) : (window as unknown as Record<string, unknown>)[key] });
}
// happy-dom lacks the Popover API; real top-layer and focus behavior is covered
// by TestDerpBirdShell and the Wayland input test.
const shownPopovers = new WeakSet<Element>();
const nativeMatches = window.Element.prototype.matches;
window.Element.prototype.matches = function(selector: string) {
  return selector === ':popover-open' ? shownPopovers.has(this as unknown as Element) : nativeMatches.call(this, selector);
};
Object.assign(window.HTMLElement.prototype, {
  showPopover() { shownPopovers.add(this as unknown as Element); },
  hidePopover() { shownPopovers.delete(this as unknown as Element); },
  getAnimations() { return []; },
});
const commands: Command[] = [];
let notify: ((snapshot: unknown) => void) | undefined;
let unsubscribed = false;
const autofillActions: unknown[] = [];
let importCalls = 0, passwordImports = 0, importDismissed = 0;
let credentialCopies = 0;
let credentialFills = 0;
let exceptionOrigins: string[] = [];
let captureReads = 0;
let captureSaves = 0;
let captureCancels = 0;
const tab = (id: string) => ({ id, url: `https://${id}.example/`, title: `Site ${id}`, attention: true, loading: false, canGoBack: true, canGoForward: false, pinned: false, private: false, audible: false, muted: false });
let preferences = { layout: 'vertical', compact: false, sidebarWidth: 196, wrapTabs: false };
let revision = 0;
const scriptCommands=[{id:'menu1',script:'Example script',label:'Fixture action',title:'Tooltip',accessKey:'r',autoClose:false}];
const state = () => ({ scriptCommands, version: 1, revision: ++revision, preferences, tabs: [tab('a'), tab('b')], activeTabId: 'a' });
Object.assign(window, { derpbird: {
  version: 1,
  autofill: async (token: string, id?: string) => { autofillActions.push({ token, id }); },
  importer: {
    status: async () => ({ welcome: false, profiles: [{ id: '/fixture/Default', name: 'Chrome · Test' }] }),
    dismiss: async () => { importDismissed++; },
    chrome: async (selection: unknown) => { assert.deepEqual(selection, { profile: '/fixture/Default', bookmarks: true, history: true, tabs: false }); importCalls++; return { bookmarks: 3, history: 4, tabs: 0, skipped: 2, warnings: [] }; },
    passwords: async () => { passwordImports++; return { passwords: 2, skipped: 1, failed: 0 }; },
  },
  credentials: {
    exceptions: {
      list: async () => exceptionOrigins,
      never: async () => { exceptionOrigins = ['https://example.com']; return exceptionOrigins; },
      allow: async () => { exceptionOrigins = []; return exceptionOrigins; },
    },
    capture: {
      read: async () => { captureReads++; return { token: '00000000-0000-4000-8000-000000000001', origin: 'https://example.com', username: 'test' }; },
      save: async (_token: string, target: unknown) => { assert(target); captureSaves++; return { id: 'fixture', origin: 'https://example.com', username: 'test', revision: '2' }; },
      cancel: async () => { captureCancels++; },
    },
    fill: async (entry: unknown) => {
      assert.deepEqual(entry, { id: 'fixture', origin: 'https://example.com', username: 'test', revision: '1' });
      credentialFills++;
    },
    copy: async (entry: unknown) => {
      assert.deepEqual(entry, { id: 'fixture', origin: 'https://example.com', username: 'test', revision: '1' });
      credentialCopies++;
    },
    list: async () => [{ id: 'fixture', origin: 'https://example.com', username: 'test', revision: '1' }],
    reveal: async () => 'fixture-only',
    save: async () => { throw new Error('Unexpected write in dialog keyboard test'); },
    remove: async () => { throw new Error('Unexpected removal in dialog keyboard test'); },
  },
  styles: {
    list: async () => ({ revision: 0, items: [] }),
    replace: async (value: { revision: number; items: unknown[] }) => ({ ...value, revision: value.revision + 1 }),
  },
  request: async (command: Command) => { commands.push(command);
    if (command.type === 'shell.set-layout') { preferences = { ...preferences, layout: command.layout }; notify?.(state()); }
    if (command.type === 'shell.set-sidebar-width') { preferences = { ...preferences, sidebarWidth: command.width }; notify?.(state()); }
    if (command.type === 'shell.set-wrap-tabs') { preferences = { ...preferences, wrapTabs: command.value }; notify?.(state()); }
  },
  snapshot: async () => state(),
  subscribe: (listener: (snapshot: unknown) => void) => { notify = listener; return () => { unsubscribed = true; }; },
} });
window.document.body.innerHTML = '<div id="app"></div>';
const html = await readFile('dist/index.html', 'utf8');
const entry = html.match(/src="([^"]+\.js)"/)?.[1];
assert(entry, 'built JS entry missing');
const stylesheet = html.match(/href="([^"]+\.css)"/)?.[1];
assert(stylesheet, 'built stylesheet missing');
const style = window.document.createElement('style');
style.textContent = await readFile(resolve('dist', stylesheet), 'utf8');
window.document.head.append(style);
await import(resolve('dist', entry));
const lastCommand = () => commands.filter(command => command.type !== 'shell.viewport').at(-1);
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
await settle();
const document = window.document;
const button = (label: string) => {
  const node = document.querySelector(`[aria-label="${label}"]`);
  assert(node, `missing control ${label}`);
  return node as unknown as HTMLElement;
};
const toggleLayout = async () => {
  button('Menu').click(); await settle();
  const item = Array.from(document.querySelectorAll('.browser-menu button')).find(item => /^(Horizontal|Vertical) tabs$/.test(item.textContent ?? '')) as unknown as HTMLButtonElement;
  assert(item); item.click(); await settle();
  (document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
};
preferences = { ...preferences, compact: true }; notify?.(state()); await settle();
assert(!document.querySelector('.shell.compact'), 'legacy compact preference is ignored');
assert(!document.querySelector('[aria-label="Toggle tab bar"]'));
assert(document.querySelector('.tab-title'));
assert.equal(window.getComputedStyle(document.querySelector('.tab > button:first-child')!).fontSize, '13px');
assert.equal(window.getComputedStyle(document.querySelector('.new-tab')!).fontSize, '13px');
assert(!document.querySelector('.needs-attention'), 'background title changes must not add attention decoration');
for (const title of document.querySelectorAll('.tab-title')) assert(!window.getComputedStyle(title).textDecoration.includes('underline'), 'tab titles must not be underlined');
document.getElementById('sidebar-resize')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); await settle();
assert.deepEqual(lastCommand(), { type: 'shell.set-sidebar-width', width: 120 });
assert.equal((document.querySelector('.shell') as unknown as HTMLElement).style.getPropertyValue('--sidebar-width'), '120px');
document.getElementById('sidebar-resize')!.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })); await settle();
assert.deepEqual(lastCommand(), { type: 'shell.set-sidebar-width', width: 196 });
assert.equal(document.querySelectorAll('[role=tab]').length, 2);
const original = document.querySelector('[role=tab]');
await toggleLayout();
assert(document.querySelector('.shell.horizontal'));
button('Menu').click(); await settle();
const wrapControl = Array.from(document.querySelectorAll('.browser-menu button')).find(item => item.textContent?.startsWith('Wrap tabs into rows')) as unknown as HTMLButtonElement;
assert(wrapControl); wrapControl.click(); await settle();
assert.deepEqual(lastCommand(), { type: 'shell.set-wrap-tabs', value: true });
assert(document.querySelector('.shell.wrap-tabs'));
wrapControl.click(); await settle();
assert(!document.querySelector('.shell.wrap-tabs'));
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();

assert.equal(document.querySelector('[role=tab]'), original, 'layout changes must retain tab DOM');
notify?.(state()); await settle();
assert.equal(document.querySelector('[role=tab]'), original, 'snapshots must retain tab DOM');
const tabKey = async (id: string, key: string) => {
  const target = document.querySelector(`[data-tab-id="${id}"]`)!;
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await settle();
};
assert.equal(document.querySelector('[data-tab-id="a"]')?.getAttribute('tabindex'), '0');
assert.equal(document.querySelector('[data-tab-id="b"]')?.getAttribute('tabindex'), '-1');
await tabKey('a', 'ArrowRight');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'b', focus: 'tab' });
assert.equal((document.activeElement as unknown as HTMLElement)?.dataset.tabId, 'b');
assert.equal(document.querySelector('[data-tab-id="a"]')?.getAttribute('aria-selected'), 'true', 'keyboard activation awaits native state');
await tabKey('b', 'ArrowRight');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'a', focus: 'tab' });
await tabKey('a', 'End');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'b', focus: 'tab' });
await tabKey('b', 'Home');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'a', focus: 'tab' });
await toggleLayout();
assert(document.querySelector('.shell.vertical'));
await tabKey('a', 'ArrowDown');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'b', focus: 'tab' });
await tabKey('a', 'ArrowUp');
assert.deepEqual(lastCommand(), { type: 'tab.activate', tabId: 'b', focus: 'tab' });
const beforeIrrelevantArrow = commands.filter(command => command.type === 'tab.activate').length;
await tabKey('a', 'ArrowRight');
assert.equal(commands.filter(command => command.type === 'tab.activate').length, beforeIrrelevantArrow, 'vertical tabs leave horizontal arrows alone');
await toggleLayout();
notify?.({ ...state(), tabs: [tab('a'), { ...tab('b'), attention: true }] });
assert.equal(document.querySelector('[data-tab-id="b"]')?.closest('.tab')?.classList.contains('needs-attention'), false);
notify?.({ ...state(), tabs: [tab('a'), { ...tab('b'), attention: false }] });
assert.equal(document.querySelector('[data-tab-id="b"]')?.closest('.tab')?.classList.contains('needs-attention'), false);
const address = document.querySelector('#location') as unknown as HTMLInputElement;
address.focus();
address.value = 'unfinished.example/path';
address.setSelectionRange(3, 8);
notify?.({ ...state(), tabs: [{ ...tab('a'), title: 'Updated title' }, { ...tab('b'), loading: true }] });
await settle();
assert.equal(document.querySelector('#location'), address, 'background events retain the address input');
assert.equal(address.value, 'unfinished.example/path', 'background events retain an unfinished address');
assert.equal(document.activeElement, address);
assert.equal(address.selectionStart, 3);
assert.equal(address.selectionEnd, 8);
// A new query retains the existing list until its replacement arrives.
address.value = 'e';
address.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
await settle();
const firstQuery = commands.findLast(command => command.type === 'browser.suggest');
assert(firstQuery?.type === 'browser.suggest');
const suggestionItems = [{ text: 'https://example.com/', title: 'Example Domain' }];
notify?.({ ...state(), addressSuggestions: { query: firstQuery.query, items: suggestionItems } });
await settle();
const popup = document.querySelector('#address-suggestions');
assert(popup, 'first suggestions appear');
assert.equal(window.getComputedStyle(popup.querySelector('button')!).width, '100%', 'suggestion rows fill the popup instead of inheriting the toolbar icon width');
address.value = 'ex';
address.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
await settle();
assert.equal(document.querySelector('#address-suggestions'), popup, 'typing retains popup while the next query is pending');
address.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event);
await settle();
assert.equal(popup.querySelector('[aria-selected=true] strong')?.textContent, 'Example Domain', 'visible results remain keyboard selectable');
assert.equal(popup.querySelector('[aria-selected=true] small')?.textContent, 'example.com');
address.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
await settle();
assert.equal(document.querySelector('#address-suggestions'), null, 'Escape closes retained suggestions');
address.focus(); address.value = 'unfinished draft';
address.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event); await settle();
assert.equal(document.querySelector('#address-suggestions'), null, 'a new edit does not reopen old results');
await settle();
const resumedQuery = commands.findLast(command => command.type === 'browser.suggest');
assert(resumedQuery?.type === 'browser.suggest');
notify?.({ ...state(), addressSuggestions: { query: resumedQuery.query, items: suggestionItems } });
await settle();
assert(document.querySelector('#address-suggestions'));
window.dispatchEvent(new window.Event('blur')); await settle();
assert.notEqual(document.activeElement, address, 'leaving the shell clears the address focus');
assert.equal(document.querySelector('#address-suggestions'), null, 'leaving the shell closes suggestions');
assert.equal(address.value, 'unfinished draft', 'switching away preserves the edit');

address.value = 'example.org:8080/docs';
address.form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
await settle();
assert.deepEqual(lastCommand(), { type: 'tab.navigate-input', tabId: 'a', url: 'example.org:8080/docs' });
button('Back').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.back', tabId: 'a' });
assert.equal((button('Forward') as HTMLButtonElement).disabled, true);
button('Menu').click(); await settle();
assert(document.querySelector('.browser-menu'));
const commandButton=Array.from(document.querySelectorAll('.script-command-menu button')).find(button=>button.textContent?.includes('Fixture action')) as HTMLButtonElement;
assert(commandButton);
commandButton.dispatchEvent(new window.MouseEvent('click',{bubbles:true,shiftKey:true}));await settle();
assert.equal(lastCommand()?.type,'script.command');
assert.equal(document.querySelector('.browser-menu')!==null,true,'autoClose=false keeps menu open');
document.querySelector('.browser-menu')!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'r',bubbles:true,cancelable:true}));await settle();
assert.deepEqual(lastCommand(),{type:'script.command',tabId:'a',id:'menu1',event:{keyboard:true,key:'r',ctrlKey:false,altKey:false,shiftKey:false,metaKey:false}});

(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
assert.equal(document.querySelector('.browser-menu'), null);
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true, cancelable: true })); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.create', private: false });
for (const isPrivate of [false, true]) {
  (document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', ctrlKey: true, shiftKey: isPrivate, bubbles: true, cancelable: true })); await settle();
  assert.deepEqual(lastCommand(), { type: 'window.new', private: isPrivate });
  button('Menu').click(); await settle();
  button(isPrivate ? 'Private window' : 'New window').click(); await settle();
  assert.deepEqual(lastCommand(), { type: 'window.new', private: isPrivate });
  assert.equal(document.querySelector('.browser-menu'), null);
}
for (const [label, page] of [['History', 'history'], ['Downloads', 'downloads'], ['Bookmarks', 'bookmarks'], ['Settings', 'settings']]) {
  button('Menu').click(); await settle(); button(label!).click(); await settle();
  assert.deepEqual(lastCommand(), { type: 'browser.open-page', page });
  assert.equal(document.querySelector('.browser-menu'), null);
}
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true })); await settle();
assert.deepEqual(lastCommand(), { type: 'browser.open-page', page: 'history' });
const reloadKey = new window.KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true });
document.getElementById('location')!.dispatchEvent(reloadKey); await settle();
assert.equal(reloadKey.defaultPrevented, true);
assert.deepEqual(lastCommand(), { type: 'tab.reload', tabId: state().activeTabId });
const context = async () => {
  document.querySelectorAll('[role=tab]')[1]!.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 2 }));
  document.querySelectorAll('[role=tab]')[1]!.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 150 }));
  await new Promise(resolve => setTimeout(resolve, 30));
};
const menuItem = (text: string) => {
  const item = Array.from(document.querySelectorAll('.tab-menu button')).find(button => button.textContent === text);
  assert(item, `missing tab action ${text}`); return item as unknown as HTMLButtonElement;
};
await context();
assert.equal(document.activeElement, document.querySelector('.tab-menu'), 'opening with the pointer does not highlight the first action');
document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
assert.equal(document.activeElement?.textContent, 'Close tab', 'ArrowUp enters the menu at the last action');
window.dispatchEvent(new window.Event('blur')); await settle();
assert.equal(document.querySelector('.tab-menu'), null, 'moving focus to the native page closes the tab menu');
button('Menu').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
button('Menu').click(); await settle();
window.dispatchEvent(new window.Event('blur')); await settle();
assert.equal(document.querySelector('.browser-menu'), null, 'moving focus to the native page closes the browser menu');
await context();
document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
assert.equal(document.activeElement?.textContent, 'Create group with new tab');
menuItem('Pin tab').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.pin', tabId: 'b', value: true });
assert.equal(document.querySelector('.tab-menu'), null);
await context(); menuItem('Mute').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.mute', tabId: 'b', value: true });
await context(); menuItem('Move left').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.move', tabId: 'b', index: 0 });
notify?.({ ...state(), tabs: [{ ...tab('a'), pinned: true }, tab('b')] }); await settle();
assert.equal(document.querySelector('[aria-label="Close Site a"]'), null);
await context(); assert.equal(menuItem('Move left').disabled, true);
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
assert.equal(document.querySelector('.tab-menu'), null);
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal((document.activeElement as unknown as HTMLElement)?.dataset.tabId, 'b');
// Group actions retain keyed tabs and forward explicit native operations.
notify?.({ ...state(), tabs: [tab('a'), { ...tab('b'), parentId: 'a' }, tab('c')] }); await settle();
assert.equal(document.querySelector('[data-tab-id="b"]')?.closest('.tab')?.getAttribute('data-group'), 'a');
assert.equal(document.querySelectorAll('.tree-root').length, 1);
assert.equal(document.querySelectorAll('.group-count').length, 0, 'groups do not render counters in either layout');
const rootMenu = async () => {
  document.querySelector('[data-tab-id="a"]')!.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 150 }));
  await new Promise(resolve => setTimeout(resolve, 30));
};
await rootMenu(); menuItem('Close tab · keep children').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.close', tabId: 'a' });
await rootMenu(); menuItem('Close entire group (2)').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.close-group', tabId: 'a' });
await rootMenu(); menuItem('New tab in group').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.new-child', tabId: 'a' });
await context(); menuItem('Move out of group').click(); await settle();
assert.deepEqual(lastCommand(), { type: 'tab.ungroup', tabId: 'b' });
notify?.(state()); await settle();
assert.equal(document.querySelectorAll('.tree-child').length, 0, 'removing parentId must update retained tab objects');
button('Menu').click(); await settle();
button('User styles').click(); await settle();
assert(document.querySelector('[role=dialog]'), 'style manager must open');
const styleButton = (label: string) => {
  const node = Array.from(document.querySelectorAll('.style-manager button')).find(node => node.textContent === label);
  assert(node, 'missing style action ' + label);
  return node as unknown as HTMLButtonElement;
};
styleButton('New style').click(); await settle();
const cssInput = document.querySelector('[aria-label="CSS style"]') as unknown as HTMLTextAreaElement;
assert(cssInput, 'style editor textarea missing');
cssInput.value = '@-moz-document domain("example.com") { body { color: red } }';
cssInput.dispatchEvent(new window.Event('input', { bubbles: true })); await settle();
(document.querySelector('[aria-label="Close styles"]') as unknown as HTMLButtonElement).click(); await settle();
assert(document.querySelector('[role=dialog]'), 'close must preserve a dirty draft');
assert(document.querySelector('[role=alert]')?.textContent?.includes('Discard unsaved changes'));
styleButton('Keep editing').click(); await settle();
styleButton('Save').click();
for (let attempt = 0; attempt < 100; attempt++) {
  await settle();
  if (styleButton('Discard changes').disabled && !cssInput.disabled) break;
}
assert(styleButton('Discard changes').disabled, 'successful save must clear dirty state');
assert(document.querySelector('.style-manager aside')?.textContent?.includes('New style'));
styleButton('Delete').click(); await settle();
assert(document.querySelector('[aria-label="Delete style confirmation"]'));
styleButton('Keep style').click(); await settle();
assert(cssInput.isConnected, 'cancelling deletion must retain the editor');
styleButton('Delete').click(); await settle();
styleButton('Delete permanently').click(); await settle();
assert.equal(document.querySelector('[aria-label="CSS style"]'), null, 'deleted style must leave the editor');
(document.querySelector('[aria-label="Close styles"]') as unknown as HTMLButtonElement).click(); await settle();
assert.equal(document.querySelector('[role=dialog]'), null);
button('Menu').click(); await settle(); button('Passwords').click(); await settle();
assert(document.querySelector('[aria-label="Passwords"][role=dialog]'));
styleButton('Show saved password').click(); await settle();
assert.equal((document.querySelector('[aria-label="Saved password"]') as unknown as HTMLInputElement).value, 'fixture-only');
// The focused control can disappear during rendering; document-level Escape
// still hides the secret instead of depending on a dialog descendant target.
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
assert.equal(document.querySelector('[aria-label="Saved password"]'), null);
assert(document.querySelector('[role=dialog]'));
styleButton('Copy password').click(); await settle();
assert.equal(credentialCopies, 1);
assert(document.querySelector('[role=status]')?.textContent?.includes('Password copied'));
assert.equal(document.querySelector('[aria-label="Saved password"]'), null);
styleButton('Fill login').click(); await settle();
assert.equal(credentialFills, 1);
assert(document.querySelector('[role=status]')?.textContent?.includes('Login filled'));
assert.equal(document.querySelector('[aria-label="Saved password"]'), null);
styleButton('Generate password').click(); await settle();
assert.match((document.querySelector('[aria-label="Password"]') as unknown as HTMLInputElement).value, /^[A-Za-z0-9_-]{24}$/);
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
assert(document.querySelector('[role=dialog]'), 'dirty generated draft must not be discarded by Escape');
styleButton('Discard changes').click(); await settle();
assert.equal((document.querySelector('[aria-label="Password"]') as unknown as HTMLInputElement).value, '');
styleButton('Save from tab').click(); await settle();
assert(document.querySelector('[aria-label="Save login confirmation"]'));
assert.equal(document.querySelector('[aria-label="Password"]'), null);
assert.equal(captureSaves, 0);
styleButton('Don’t save').click(); await settle(); assert.equal(captureCancels, 1);
styleButton('Save from tab').click(); await settle();
styleButton('Update password for test').click(); await settle();
assert.equal(captureSaves, 1);
assert.equal(document.querySelector('[aria-label="Save login confirmation"]'), null);
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
assert.equal(document.querySelector('[role=dialog]'), null);
const submitted = { token: '00000000-0000-4000-8000-000000000002', origin: 'https://example.com', username: 'test' };
notify?.({ ...state(), credentialProposal: submitted }); await settle();
assert.equal(document.querySelector('[role=dialog]'), null, 'suggestion must not steal focus or open a modal');
const priorReads = captureReads;
const suggestionButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Save password?');
assert(suggestionButton); suggestionButton.click(); await settle();
assert(document.querySelector('[aria-label="Save login confirmation"]'));
assert.equal(document.querySelector('[aria-label="Password"]'), null);
assert.equal(captureReads, priorReads, 'submitted values must not be recaptured from destination page');
assert.equal(captureSaves, 1, 'opening suggestion must not save');
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
assert.equal(document.querySelector('[aria-label="Save login confirmation"]'), null);
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
assert.equal(document.querySelector('[role=dialog]'), null);
notify?.({ ...state(), credentialProposal: null }); await settle();
assert(!Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Save password?'));
notify?.({ ...state(), credentialProposal: submitted }); await settle();
Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Save password?')!.click(); await settle();
styleButton('Never for this site').click(); await settle();
assert.equal(document.querySelector('[aria-label="Save login confirmation"]'), null);
assert(document.querySelector('summary')?.textContent?.includes('(1)'));
document.querySelector('summary')!.click(); await settle();
button('Allow prompts for https://example.com').click(); await settle();
assert(document.querySelector('summary')?.textContent?.includes('(0)'));
assert.equal(captureSaves, 1, 'exception changes must not save a password');
exceptionOrigins = Array.from({ length: 4096 }, (_, i) => `https://site${i}.example`);
styleButton('Reload').click(); await settle();
assert.equal(document.querySelectorAll('.credential-exceptions button').length, 100, 'exception list must bound rendered rows');
const exceptionSearch = document.querySelector<HTMLInputElement>('[aria-label="Search passwords"]')!;
exceptionSearch.value = 'site4095.example'; exceptionSearch.dispatchEvent(new window.Event('input', { bubbles: true })); await settle();
assert.equal(document.querySelectorAll('.credential-exceptions button').length, 1);
assert(document.querySelector('[aria-label="Allow prompts for https://site4095.example"]'));
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
button('Menu').click(); await settle();
const journal = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Request log');
assert(journal); journal.click(); await settle();
assert(commands.some(c => c.type === 'blocking.log' && c.visible));
notify?.({ ...state(), blockingLog: { tabId: 'a', entries: [{ id: 1, url: 'https://ads.example/pixel', kind: 'Image' }, { id: 2, url: 'https://tracker.example/code.js', kind: 'Script', rule: '||tracker.example^$script,third-party' }] } }); await settle();
assert.equal(document.querySelectorAll('.blocking-log-row').length, 2);
const logSearch = document.querySelector<HTMLInputElement>('[aria-label="Search requests"]')!;
logSearch.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })); await settle();
assert(document.querySelector('.blocking-log'), 'pointer inside journal must not dismiss it');
logSearch.value = 'third-party'; logSearch.dispatchEvent(new window.Event('input', { bubbles: true })); await settle();
assert.equal(document.querySelectorAll('.blocking-log-row').length, 1);
const ruleDetails = document.querySelector('.blocking-log-row details') as HTMLDetailsElement;
assert(ruleDetails); ruleDetails.open = true;
assert(ruleDetails.textContent?.includes('||tracker.example^$script,third-party'));
const clearLog = Array.from(document.querySelectorAll('.blocking-log button')).find(b => b.textContent === 'Clear') as HTMLButtonElement;
clearLog.click(); await settle();
assert(commands.some(c => c.type === 'blocking.clear' && c.tabId === 'a'));
button('Close log').click(); await settle();
assert.equal(document.querySelector('.blocking-log'), null);
assert(commands.some(c => c.type === 'blocking.log' && !c.visible));
button('Menu').click(); await settle();
const importButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Import browser data')!;
assert(importButton); importButton.click(); await settle();
assert(document.querySelector('.import-manager'));
const importAction = (text: string) => { const b = Array.from(document.querySelectorAll<HTMLButtonElement>('.import-manager button')).find(b => b.textContent === text)!; assert(b); b.click(); };
importAction('Import selected data'); await settle();
assert.equal(importCalls, 1); assert(document.querySelector('.import-result')?.textContent?.includes('3 bookmarks imported'));
importAction('Choose password CSV…'); await settle();
assert.equal(passwordImports, 1); assert(document.querySelector('.import-result')?.textContent?.includes('2 passwords imported'));
importAction('Done'); await settle();
assert(!document.querySelector('.import-manager')); assert.equal(importDismissed, 3);
notify?.({ ...state(), credentialAutofill: { token: '7', origin: 'https://a.example', x: 100, y: 120, items: [{ id: 'imported', origin: 'https://a.example', username: 'alice', revision: '1' }] } }); await settle();
assert(document.querySelector('.credential-autofill')?.textContent?.includes('alice'));
(document.querySelector('.credential-autofill button[data-credential-id]') as HTMLButtonElement).click(); await settle();
assert.deepEqual(autofillActions.at(-1), { token: '7', id: 'imported' });
document.querySelector('.credential-autofill button')!.focus();
(document.activeElement ?? document).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
assert.deepEqual(autofillActions.at(-1), { token: '7', id: undefined });
notify?.({ ...state(), credentialAutofill: null }); await settle();
assert(!document.querySelector('.credential-autofill'));
window.dispatchEvent(new window.Event('pagehide')); await settle();
assert(unsubscribed, 'page teardown must unsubscribe native bridge');
await window.happyDOM.close();
console.log('Built UI DOM checks passed: native events, keyed rows, layout, navigation, menu, shortcuts, teardown.');
