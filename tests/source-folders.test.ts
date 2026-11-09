import { expect, test } from 'bun:test';
import { syncScriptFolders } from '../src/browser/source-folder-sync';
import { decodeSourceFolders, readSourceFile } from '../src/browser/source-files';
import { parseUserScript } from '../src/browser/user-scripts';
import type { ScriptSnapshot } from '../src/browser/script-protocol';
const source = '// ==UserScript==\n// @name Folder script\n// @match https://example.org/*\n// ==/UserScript==\n';
const id = 'folder_' + 'a'.repeat(64);
test('directory reconciliation preserves ordinary scripts and disabled state; removes deleted files', async () => {
  const item = { id, source, name: 'Folder script', enabled: false, fileAccessGranted: false, metadata: parseUserScript(source) };
  let snapshot: ScriptSnapshot = { revision: 1, items: [item, { ...item, id: 'manual' }, { ...item, id: 'folder_' + 'b'.repeat(64) }] };
  let writes = 0;
  const port = {
    folders: async () => ({ directories: ['/scripts'], files: [{ id, name: 'test.user.js', source: source + 'void 0;' }] }),
    list: async () => snapshot,
    replace: async (next: ScriptSnapshot) => { writes++; snapshot = { ...next, revision: next.revision + 1 }; return snapshot; },
  };
  await syncScriptFolders(port);
  expect(snapshot.items.map(item => item.id)).toEqual(['manual', id]);
  expect(snapshot.items[1].enabled).toBe(false);
  expect(snapshot.items[1].source).toEndWith('void 0;');
  await syncScriptFolders(port);
  expect(writes).toBe(1);
});
test('one invalid source prevents the whole directory update', async () => {
  let writes = 0;
  await expect(syncScriptFolders({
    folders: async () => ({ directories: ['/scripts'], files: [{ id, name: 'valid.js', source }, { id: 'folder_' + 'c'.repeat(64), name: 'invalid.js', source: 'bad' }] }),
    list: async () => ({ revision: 4, items: [] }),
    replace: async next => { writes++; return next; },
  })).rejects.toThrow();
  expect(writes).toBe(0);
});
test('source file import rejects binary and oversized files', async () => {
  await expect(readSourceFile(new File(['a\0b'], 'bad.js'))).rejects.toThrow();
  await expect(readSourceFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.js'))).rejects.toThrow();
  expect(decodeSourceFolders({ directories: ['/scripts'], files: [{ id, name: 'x.js', source }] }).files).toHaveLength(1);
  expect(() => decodeSourceFolders({ directories: [], files: [{ id: 'manual', name: 'x', source }] })).toThrow();
});

test('dependency-only changes invalidate folder caches without changing source or enabled state', async () => {
  const before = 'a'.repeat(64), after = 'b'.repeat(64);
  let snapshot: ScriptSnapshot = { revision: 1, items: [{ id, name: 'Folder script', source, enabled: false, fileAccessGranted: false, metadata: parseUserScript(source), dependencyRevision: before }] };
  let writes = 0;
  const port = { folders: async () => ({ directories: ['/scripts'], files: [{ id, name: 'test.user.js', source, dependencyRevision: after }] }), list: async () => snapshot,
    replace: async (next: ScriptSnapshot) => { writes++; snapshot = { ...next, revision: next.revision + 1 }; return snapshot; } };
  await syncScriptFolders(port);
  expect(snapshot.items[0].dependencyRevision).toBe(after);
  expect(snapshot.items[0].source).toBe(source);
  expect(snapshot.items[0].enabled).toBe(false);
  await syncScriptFolders(port);
  expect(writes).toBe(1);
});

test('local style dependencies recompile on library changes and retain prior installation on deletion', async () => {
  const { syncStyleFolders } = await import('../src/browser/source-folder-sync');
  const base = 'https://derpbird-source.invalid/' + 'a'.repeat(64) + '/nested/theme.user.less';
  const library = new URL('../palette.less', base).href;
  const style = '/* ==UserStyle==\n@name Local\n@namespace test\n@version 1.0.0\n@preprocessor less\n==/UserStyle== */\n@import "../palette.less";\n@-moz-document domain("example.com") {body {color:@accent}}';
  let revision = 'a'.repeat(64), color = 'red', deleted = false;
  let snapshot: import('../src/browser/style-protocol').StyleSnapshot = { revision: 1, items: [] };
  let writes = 0;
  const port: import('../src/browser/style-protocol').UserStylePort = {
    folders: async () => ({ directories: ['/styles'], files: [{ id, name: 'theme.user.less', source: style, sourceBaseURL: base, dependencyRevision: revision }], imports: deleted ? {} : { [library]: { url: library, source: `@accent: ${color};` } } }),
    list: async () => snapshot,
    replace: async next => { writes++; snapshot = { ...next, revision: next.revision + 1 }; return snapshot; },
    fetchSource: async () => { throw new Error('Local imports must not use network'); },
  };
  await syncStyleFolders(port);
  expect(snapshot.items[0].sections[0].css).toContain('red');
  expect(snapshot.items[0].sourceBaseURL).toBe(base);
  expect(Object.keys(snapshot.items[0].imports!)).toEqual([library]);
  await syncStyleFolders(port);
  expect(writes).toBe(1);
  color = 'green'; revision = 'b'.repeat(64);
  await syncStyleFolders(port);
  expect(snapshot.items[0].sections[0].css).toContain('green');
  deleted = true; revision = 'c'.repeat(64);
  await expect(syncStyleFolders(port)).rejects.toThrow('Local dependency missing');
  expect(writes).toBe(2);
  expect(snapshot.items[0].sections[0].css).toContain('green');
});
