import { expect, test } from 'bun:test';
import { createScriptController } from '../src/browser/script-controller';
import { createStyleController } from '../src/browser/style-controller';
import { syncScriptFolders, syncStyleFolders } from '../src/browser/source-folder-sync';
import { parseUserScript } from '../src/browser/user-scripts';
import type { ScriptSnapshot, UserScriptPort } from '../src/browser/script-protocol';
import type { StyleSnapshot, UserStylePort } from '../src/browser/style-protocol';

const id = 'folder_' + 'a'.repeat(64);
async function settle(controller: { state(): { busy: boolean } }) {
  const deadline = Date.now() + 3000;
  while (controller.state().busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(controller.state().busy).toBe(false);
}

test('script conflict override survives scans until disk source/dependencies change again', async () => {
  const source = '// ==UserScript==\n// @name Folder\n// @match https://example.com/*\n// ==/UserScript==\n';
  let disk = source, revision = 'a'.repeat(64);
  let stored: ScriptSnapshot = { revision: 1, items: [{ id, name: 'Folder', source, enabled: true, fileAccessGranted: false, metadata: parseUserScript(source), dependencyRevision: revision }] };
  const port: UserScriptPort = {
    folders: async () => ({ directories: ['/scripts'], files: [{ id, name: 'folder.user.js', source: disk, dependencyRevision: revision }] }),
    list: async () => stored,
    replace: async next => stored = { ...next, revision: next.revision + 1 },
  };
  const editor = createScriptController(port);
  try {
    editor.load(); await settle(editor);
    const local = source + '// local override';
    editor.change({ source: local });
    disk = source + '// disk update'; revision = 'b'.repeat(64);
    editor.save(); await settle(editor);
    expect(editor.state().conflict).toBe(true);
    expect(editor.state().draft?.source).toBe(local);
    editor.continueDraft(); editor.save(); await settle(editor);
    expect(editor.state().dirty).toBe(false);
    await syncScriptFolders(port);
    expect(stored.items[0].source).toBe(local);
    expect(stored.items[0].dependencyRevision).toBe(revision);
    editor.folders(); await settle(editor);
    expect(stored.items[0].source).toBe(local);
    expect(stored.items[0].dependencyRevision).toBe(revision);
    editor.load(); await settle(editor);
    expect(editor.state().draft?.source).toBe(local);
    revision = 'c'.repeat(64); // A dependency-only disk change must still invalidate the override.
    await syncScriptFolders(port);
    expect(stored.items[0].source).toBe(disk);
  } finally { await editor.close(); }
});

test('style conflict override survives scans until disk source/dependencies change again', async () => {
  const source = 'body { color: red }';
  let disk = source, revision = 'a'.repeat(64);
  let stored: StyleSnapshot = { revision: 1, items: [{ id, name: 'Folder', source, enabled: true, sections: [{ conditions: [], css: source }], dependencyRevision: revision }] };
  const port: UserStylePort = {
    folders: async () => ({ directories: ['/styles'], files: [{ id, name: 'folder.user.css', source: disk, dependencyRevision: revision }] }),
    list: async () => stored,
    replace: async next => stored = { ...next, revision: next.revision + 1 },
  };
  const editor = createStyleController(port);
  try {
    editor.load(); await settle(editor);
    const local = 'body { color: blue }';
    editor.change({ source: local });
    disk = 'body { color: green }'; revision = 'b'.repeat(64);
    editor.save(); await settle(editor);
    expect(editor.state().conflict).toBe(true);
    expect(editor.state().draft?.source).toBe(local);
    editor.continueDraft(); editor.save(); await settle(editor);
    expect(editor.state().dirty).toBe(false);
    await syncStyleFolders(port);
    expect(stored.items[0].source).toBe(local);
    expect(stored.items[0].dependencyRevision).toBe(revision);
    editor.folders(); await settle(editor);
    expect(stored.items[0].source).toBe(local);
    expect(stored.items[0].dependencyRevision).toBe(revision);
    editor.load(); await settle(editor);
    expect(editor.state().draft?.source).toBe(local);
    revision = 'c'.repeat(64);
    await syncStyleFolders(port);
    expect(stored.items[0].source).toBe(disk);
  } finally { await editor.close(); }
});

for (const kind of ['script', 'style'] as const) {
  test(`${kind} deleted folder source cannot be recreated as an orphan by saving a draft`, async () => {
    const source = kind === 'script'
      ? '// ==UserScript==\n// @name Folder\n// @match https://example.com/*\n// ==/UserScript==\n'
      : 'body { color: red }';
    let present = true;
    const common = { id, name: 'Folder', source, enabled: true, dependencyRevision: 'a'.repeat(64) };
    let scripts: ScriptSnapshot = { revision: 1, items: [{ ...common, fileAccessGranted: false, metadata: parseUserScript(kind === 'script' ? source : '// ==UserScript==\n// @name Test\n// ==/UserScript==') }] };
    let styles: StyleSnapshot = { revision: 1, items: [{ ...common, sections: [{ conditions: [], css: source }] }] };
    const folders = async () => ({ directories: ['/sources'], files: present ? [{ id, name: common.name, source, dependencyRevision: common.dependencyRevision }] : [] });
    const editor = kind === 'script'
      ? createScriptController({ folders, list: async () => scripts, replace: async next => scripts = { ...next, revision: next.revision + 1 } })
      : createStyleController({ folders, list: async () => styles, replace: async next => styles = { ...next, revision: next.revision + 1 } });
    try {
      editor.load(); await settle(editor);
      editor.change({ name: 'Retained draft' });
      present = false;
      editor.save(); await settle(editor);
      expect(editor.state().error).toContain('Source disconnected');
      expect(editor.state().draft?.name).toBe('Retained draft');
      expect(editor.state().dirty).toBe(true);
      editor.continueDraft(); editor.save(); await settle(editor);
      expect((kind === 'script' ? scripts : styles).items).toHaveLength(0);
      present = true;
      editor.save(); await settle(editor);
      expect(editor.state().error).toBeNull();
      expect((kind === 'script' ? scripts : styles).items[0].name).toBe('Retained draft');
    } finally { await editor.close(); }
  });
}
