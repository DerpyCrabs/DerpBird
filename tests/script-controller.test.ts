import { expect, test } from 'bun:test';
import { createScriptController, type ScriptController } from '../src/browser/script-controller';
import { decodeScriptSnapshot, scriptExecutionNotice, type ScriptSnapshot } from '../src/browser/script-protocol';
import { parseUserScript } from '../src/browser/user-scripts';

const source = '// ==UserScript==\n// @name Example\n// @match https://example.com/*\n// ==/UserScript==\ndocument.title = "script";';
const initial = (): ScriptSnapshot => ({ revision: 3, items: [{ id: 'one', name: 'Example', source, enabled: true, fileAccessGranted: false, metadata: parseUserScript(source) }] });
async function settled(controller: ScriptController) {
  const deadline = Date.now() + 3000;
  while (controller.state().busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(controller.state().busy).toBe(false);
}

test('script editor imports metadata, rejects malformed source, and keeps draft after conflict', async () => {
  let writes = 0; let conflict = false;
  let stored = initial();
  const controller = createScriptController({ list: async () => stored, replace: async value => {
    writes++;
    if (conflict) throw new Error('Userscripts changed in another window');
    stored = { ...decodeScriptSnapshot(value), revision: value.revision + 1 };
    return stored;
  } });
  try {
    controller.load(); await settled(controller);
    controller.change({ source: 'invalid header' });
    controller.save(); await settled(controller);
    expect(writes).toBe(0);
    expect(controller.state().dirty).toBe(true);
    controller.change({ source: source.replace('example.com', 'example.org') });
    controller.save(); controller.save(); await settled(controller);
    expect(writes).toBe(1);
    expect(controller.state().snapshot?.items[0].metadata.matches).toEqual(['https://example.org/*']);
    expect(controller.state().snapshot?.revision).toBe(4);
    conflict = true;
    controller.change({ enabled: false });
    controller.save(); await settled(controller);
    expect(controller.state().dirty).toBe(true);
    expect(controller.state().draft?.enabled).toBe(false);
    controller.load();
    expect(controller.state().snapshot?.revision).toBe(4);
    controller.discard();
    expect(controller.state().draft?.enabled).toBe(true);
    expect(controller.state().dirty).toBe(false);
  } finally { await controller.close(); }
});

test('script editor requires confirmation for deletion and preserves metadata entries', async () => {
  let writes = 0;
  const controller = createScriptController({ list: async () => decodeScriptSnapshot(initial()), replace: async value => { writes++; return { ...value, revision: 4 }; } });
  try {
    controller.load(); await settled(controller);
    expect(controller.state().snapshot?.items[0].metadata).toEqual(parseUserScript(source));
    controller.remove(); expect(writes).toBe(0);
    controller.requestRemove(); controller.remove(); await settled(controller);
    expect(writes).toBe(1);
    expect(controller.state().snapshot?.items).toEqual([]);
    expect(controller.state().draft).toBeNull();
    controller.create();
    expect(parseUserScript(controller.state().draft!.source).matches).toEqual(['https://example.com/*']);
  } finally { await controller.close(); }
});

test('script protocol rejects malformed native snapshots and reports unsupported execution requirements', () => {
  const item = initial().items[0];
  expect(decodeScriptSnapshot(initial()).items[0]).toEqual({ ...item, dependenciesReady: true, resourcesReady: true });
  expect(() => decodeScriptSnapshot({ ...initial(), revision: -1 })).toThrow();
  expect(() => decodeScriptSnapshot({ ...initial(), items: [item, item] })).toThrow();
  for (const update of [{ id: '../x' }, { fileAccessGranted: 'yes' }, { source: null }, { metadata: { ...item.metadata, grants: 'GM_getValue' } }]) {
    expect(() => decodeScriptSnapshot({ ...initial(), items: [{ ...item, ...update }] })).toThrow();
  }
  expect(scriptExecutionNotice(item)).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grants: ['GM_info', 'GM.info', 'GM_addStyle', 'GM.addStyle', 'GM_addElement', 'GM.addElement', 'GM_log', 'GM.log', 'GM_setClipboard', 'GM.setClipboard', 'GM_openInTab', 'GM.openInTab', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_getValues', 'GM_setValues', 'GM_deleteValues', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_registerMenuCommand', 'GM.registerMenuCommand', 'GM_unregisterMenuCommand', 'GM.unregisterMenuCommand'] } })).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grants: ['GM_getTab', 'GM.getTab', 'GM_saveTab', 'GM.saveTab', 'GM_getTabs', 'GM.getTabs', 'GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.listValues', 'GM.getValues', 'GM.setValues', 'GM.deleteValues', 'GM.addValueChangeListener', 'GM.removeValueChangeListener'] } })).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grantNone: true } })).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grants: ['GM_notification', 'GM.notification', 'GM_download', 'GM.download'] } })).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grants: ['GM_cookie', 'GM.cookie', 'unsafeWindow'] } })).toBeNull();
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, matches: [] } })).toContain('@match');
});

test('script dependency status comes from native cache, not an editor flag', () => {
  const item = initial().items[0];
  const url = 'https://example.com/library.js';
  const dependent = { ...item, metadata: { ...item.metadata, requires: [url] } };
  const decode = (value: unknown) => decodeScriptSnapshot({ revision: 1, items: [value] }).items[0];
  expect(scriptExecutionNotice(decode({ ...dependent, dependenciesReady: true }))).toContain('@require');
  const installed = decode({ ...dependent, requiredSources: [{ url, source: 'var library = 42;' }] });
  expect(scriptExecutionNotice(installed)).toBeNull();
  expect('requiredSources' in installed).toBe(false);
});

test('script manager recognizes wired request, audio and window grants', () => {
  const item = initial().items[0];
  for (const grant of ['GM_webRequest', 'GM.audio', 'GM_audio', 'window.onurlchange', 'window.close', 'window.focus']) {
    expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, grants: [grant] } })).toBeNull();
  }
  expect(scriptExecutionNotice({ ...item, metadata: { ...item.metadata, runAt: 'context-menu', matches: [], includes: [] } })).toContain('контекстного меню');
});

test('script editor preserves external edits until the user resolves a same-source conflict', async () => {
  let snapshot = initial();
  let writes = 0;
  const controller = createScriptController({ list: async () => snapshot, replace: async value => {
    expect(value.revision).toBe(snapshot.revision);
    writes++;
    return snapshot = { ...value, revision: value.revision + 1 };
  } });
  try {
    controller.load(); await settled(controller);
    controller.change({ name: 'My draft' });
    snapshot = { revision: 4, items: [{ ...snapshot.items[0], name: 'External version' }] };
    controller.save(); await settled(controller);
    expect(writes).toBe(0);
    expect(controller.state().conflict).toBe(true);
    expect(controller.state().draft?.name).toBe('My draft');
    controller.save(); await settled(controller);
    expect(writes).toBe(0);
    controller.continueDraft();
    controller.save(); await settled(controller);
    expect(snapshot.items[0].name).toBe('My draft');
    expect(writes).toBe(1);
    controller.change({ name: 'Second draft' });
    snapshot = { revision: 6, items: [...snapshot.items, { ...snapshot.items[0], id: 'two', name: 'Other script' }] };
    controller.save(); await settled(controller);
    expect(snapshot.items.map(item => item.name)).toEqual(['Second draft', 'Other script']);
  } finally { await controller.close(); }
});


test('local-file permission uses the dedicated revision-bound operation and refuses dirty drafts', async () => {
  let stored = initial();
  let changes = 0;
  const controller = createScriptController({
    list: async () => stored,
    replace: async () => { throw new Error('Permission must not use editor replace'); },
    setFileAccess: async (id, granted, revision) => {
      expect(revision).toBe(stored.revision);
      changes++;
      stored = { revision: revision + 1, items: stored.items.map(item => item.id === id ? { ...item, fileAccessGranted: granted } : item) };
      return stored;
    },
  });
  try {
    controller.load(); await settled(controller);
    controller.setFileAccess(true); await settled(controller);
    expect(controller.state().snapshot?.items[0].fileAccessGranted).toBe(true);
    controller.change({ source: source + '\n// edited' });
    controller.setFileAccess(false); await settled(controller);
    expect(changes).toBe(1);
    expect(controller.state().dirty).toBe(true);
    controller.discard();
    controller.setFileAccess(false); await settled(controller);
    expect(changes).toBe(2);
    expect(controller.state().snapshot?.items[0].fileAccessGranted).toBe(false);
  } finally { await controller.close(); }
});


test('script URL download cancellation preserves the draft and allows a retry', async () => {
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let attempts = 0, writes = 0;
  const controller = createScriptController({
    list: async () => initial(),
    replace: async value => { writes++; return value; },
    fetchSource: (url, signal) => {
      attempts++;
      if (attempts > 1) return Promise.resolve({ url, source: initial().items[0].source });
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        began();
      });
    },
  });
  try {
    controller.load(); await settled(controller);
    const draft = controller.state().draft;
    controller.importURL('https://example.org/source'); await started;
    expect(controller.state().downloading).toBe(true);
    controller.cancelDownload(); await settled(controller);
    expect(controller.state().draft).toEqual(draft);
    expect(controller.state().downloading).toBe(false);
    expect(writes).toBe(0);
    controller.importURL('https://example.org/source'); await settled(controller);
    expect(controller.state().dirty).toBe(true);
    expect(attempts).toBe(2);
    expect(writes).toBe(0);
  } finally { await controller.close(); }
});
