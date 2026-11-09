import { expect, test } from 'bun:test';
import { checkSourceUpdates } from '../src/browser/source-updates';
import { parseUserScript } from '../src/browser/user-scripts';
import { createScriptController } from '../src/browser/script-controller';
import type { ScriptSnapshot, UserScriptPort } from '../src/browser/script-protocol';
import type { StyleSnapshot, UserStylePort } from '../src/browser/style-protocol';
const old = '// ==UserScript==\n// @name Updated\n// @version 1\n// @match https://example.org/*\n// @require ./lib.js\n// @resource sheet ./theme.css\n// ==/UserScript==\nvoid 0;';
test('UserCSS updates use the installed endpoint and stage only newer versions', async () => {
  const css = (version: string) => `/* ==UserStyle==\n@name Theme\n@namespace example\n@version ${version}\n@updateURL https://updates.example/theme.user.css\n==/UserStyle== */\nbody { color: red; }`;
  for (const [version, staged] of [['0.9', false], ['1.0.0', false], ['1.1-beta.1', true], ['1.1', true]] as const) {
    let snapshot: StyleSnapshot = { revision: 1, items: [{ id: 'theme', name: 'Theme', source: css('1.0'), sourceURL: 'https://install.example/theme.user.css', checkUpdates: true, enabled: true, sections: [{ css: 'body { color: red; }', conditions: [] }] }] };
    const requests: string[] = [];
    const port: UserStylePort = {
      list: async () => snapshot,
      replace: async (next: StyleSnapshot) => { snapshot = { ...next, revision: next.revision + 1 }; return snapshot; },
      fetchSource: async url => { requests.push(url); return { url, source: css(version).replace('updates.example', 'next.example') }; },
    };
    await checkSourceUpdates(port, false, 100_000_000);
    expect(requests).toEqual(['https://updates.example/theme.user.css']);
    expect(!!snapshot.items[0]!.pendingUpdate).toBe(staged);
    expect(snapshot.items[0]!.source).toBe(css('1.0'));
  }
});
test('relative dependencies retain the final install URL as their base', () => {
  const meta = parseUserScript(old, 'https://example.org/scripts/source.user.js');
  expect(meta.requires).toEqual(['https://example.org/scripts/lib.js']);
  expect(meta.resources[0].url).toBe('https://example.org/scripts/theme.css');
  expect(() => parseUserScript(old.replace('./lib.js', 'file:///secret'), 'https://example.org/source.user.js')).toThrow();
});
test('automatic update checks stage source without changing active code or grants', async () => {
  let snapshot: ScriptSnapshot = { revision: 3, items: [{ id: 'one', name: 'Updated', source: old, sourceURL: 'https://example.org/source.user.js', enabled: true, checkUpdates: true, fileAccessGranted: false, metadata: parseUserScript(old) }] };
  let fetched = 0;
  const updated = old.replace('@version 1', '@version 2\n// @grant GM_setClipboard');
  const port: UserScriptPort = { list: async () => snapshot, replace: async next => { snapshot = { ...next, revision: next.revision + 1 }; return snapshot; }, fetchSource: async url => { fetched++; return { url, source: updated }; } };
  await checkSourceUpdates(port, true, 100_000_000);
  expect(snapshot.items[0].source).toBe(old);
  expect(snapshot.items[0].metadata.grants).toEqual([]);
  expect(snapshot.items[0].pendingUpdate?.source).toBe(updated);
  await checkSourceUpdates(port, true, 100_000_001);
  expect(fetched).toBe(1);
  const editor = createScriptController(port);
  const settled = async () => { for (let n = 0; n < 100 && editor.state().busy; n++) await new Promise(resolve => setTimeout(resolve, 5)); };
  try {
    editor.load(); await settled();
    editor.reviewUpdate(); await settled();
    expect(editor.state().dirty).toBe(true);
    expect(editor.state().updateReview).toContain('GM_setClipboard');
    expect(snapshot.items[0].source).toBe(old);
    editor.discard();
    expect(editor.state().draft?.source).toBe(old);
  } finally { await editor.close(); }
});

test('updateURL checks metadata first and downloadURL none disables network checks', async () => {
  const source = old.replace('// @version 1', '// @version 1\n// @updateURL ./latest.meta.js\n// @downloadURL ./latest.user.js');
  let snapshot: ScriptSnapshot = { revision: 1, items: [{ id: 'one', name: 'Updated', source, sourceURL: 'https://example.org/source.user.js', enabled: true, checkUpdates: true, fileAccessGranted: false, metadata: parseUserScript(source) }] };
  let version = '1';
  const requests: string[] = [];
  const port: UserScriptPort = { list: async () => snapshot, replace: async next => { snapshot = { ...next, revision: next.revision + 1 }; return snapshot; }, fetchSource: async url => { requests.push(url); return { url, source: source.replace('@version 1', '@version ' + version) }; } };
  await checkSourceUpdates(port, true, 100_000_000);
  expect(requests).toEqual(['https://example.org/latest.meta.js']);
  expect(snapshot.items[0].pendingUpdate).toBeUndefined();
  version = '2'; requests.length = 0;
  await checkSourceUpdates(port, true, 200_000_000);
  expect(requests).toEqual(['https://example.org/latest.meta.js', 'https://example.org/latest.user.js']);
  expect(snapshot.items[0].source).toBe(source);
  expect(snapshot.items[0].pendingUpdate?.source).toContain('@version 2');
  snapshot = { revision: snapshot.revision, items: [{ ...snapshot.items[0], pendingUpdate: undefined, source: source.replace('@downloadURL ./latest.user.js', '@downloadURL none') }] };
  requests.length = 0;
  await checkSourceUpdates(port, true, 300_000_000);
  expect(requests).toEqual([]);
});

test('closing an update owner before work starts performs no registry or network calls', async () => {
  const calls: string[] = [];
  const port: UserScriptPort = {
    list: async () => { calls.push('list'); return { revision: 1, items: [] }; },
    replace: async next => { calls.push('replace'); return next; },
    fetchSource: async url => { calls.push('fetch'); return { url, source: old }; },
  };
  await checkSourceUpdates(port, true, 100_000_000, () => false);
  expect(calls).toEqual([]);
});

test('revocation during metadata download prevents executable download and registry writes', async () => {
  const source = old.replace('// @version 1', '// @version 1\n// @updateURL ./latest.meta.js\n// @downloadURL ./latest.user.js');
  let active = true;
  let writes = 0;
  const requests: string[] = [];
  const port: UserScriptPort = {
    list: async () => ({ revision: 1, items: [{ id: 'one', name: 'Updated', source, sourceURL: 'https://example.org/source.user.js', enabled: true, checkUpdates: true, fileAccessGranted: false, metadata: parseUserScript(source) }] }),
    replace: async next => { writes++; return next; },
    fetchSource: async url => { requests.push(url); active = false; return { url, source: source.replace('@version 1', '@version 2') }; },
  };
  await checkSourceUpdates(port, true, 100_000_000, () => active);
  expect(requests).toEqual(['https://example.org/latest.meta.js']);
  expect(writes).toBe(0);
});

test('automatic discovery rejects stale manifests and stale executable versions independently', async () => {
  for (const [manifestVersion, executableVersion, expectedFetches, staged] of [
    ['0.9', '2', 1, false], ['1.0.0', '2', 1, false],
    ['2', '0.9', 2, false], ['2', '1.0', 2, false], ['2', '2', 2, true],
    [null, '0.9', 1, false], [null, '1.0', 1, false], [null, '2', 1, true],
  ] as const) {
    const source = manifestVersion === null ? old : old.replace('// @version 1', '// @version 1\n// @updateURL ./latest.meta.js');
    let snapshot: ScriptSnapshot = { revision: 1, items: [{ id: 'one', name: 'Updated', source, sourceURL: 'https://example.org/source.user.js', enabled: true, checkUpdates: true, fileAccessGranted: false, metadata: parseUserScript(source) }] };
    let requests = 0;
    await checkSourceUpdates({
      list: async () => snapshot,
      replace: async (next: ScriptSnapshot) => { snapshot = { ...next, revision: next.revision + 1 }; return snapshot; },
      fetchSource: async url => {
        requests++;
        const version = url.endsWith('.meta.js') ? manifestVersion : executableVersion;
        return { url, source: old.replace('@version 1', `@version ${version}`) + '\n// changed body' };
      },
    }, true, 100_000_000);
    expect(requests).toBe(expectedFetches);
    expect(!!snapshot.items[0].pendingUpdate).toBe(staged);
    expect(snapshot.items[0].source).toBe(source);
    expect(snapshot.items[0].checkedAt).toBe(100_000_000);
  }
});


test('aborting automatic updates cancels the in-flight download without a registry write', async () => {
  const abort = new AbortController();
  let writes = 0;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const port: UserScriptPort = {
    list: async () => ({ revision: 1, items: [{ id: 'one', name: 'Updated', source: old, sourceURL: 'https://example.org/source.user.js', enabled: true, checkUpdates: true, fileAccessGranted: false, metadata: parseUserScript(old) }] }),
    replace: async next => { writes++; return next; },
    fetchSource: (_url, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); started();
    }),
  };
  const work = checkSourceUpdates(port, true, 100_000_000, () => true, abort.signal);
  await ready; abort.abort(); await work;
  expect(writes).toBe(0);
});


test('native cancellation before pagehide leaves both source registries immediately retryable', async () => {
  const { sourceDownloadError } = await import('../src/browser/source-files');
  for (const scripts of [true, false]) {
    const source = scripts ? old : '/* ==UserStyle==\n@name Theme\n@namespace test\n@version 1.0.0\n==/UserStyle== */ body { color: red }';
    for (const reason of ['Source download cancelled', 'Source editor document expired']) {
      let snapshot: any = { revision: 1, items: [{ id: 'one', name: 'Theme', source, sourceURL: 'https://example.org/source', enabled: true, checkUpdates: true, checkedAt: 0, fileAccessGranted: false, metadata: parseUserScript(old), sections: [] }] };
      let canceled = true, writes = 0, requests = 0;
      const port: UserScriptPort = { list: async () => snapshot, replace: async next => { writes++; snapshot = { ...next, revision: next.revision + 1 }; return snapshot; }, fetchSource: async url => {
        requests++; if (canceled) throw sourceDownloadError(reason);
        return { url, source: source.replace('@version 1', '@version 2') };
      } };
      await expect(checkSourceUpdates(port, scripts, 100_000_000)).rejects.toThrow(reason);
      expect(writes).toBe(0);
      expect(snapshot.items[0].checkedAt).toBe(0);
      expect(snapshot.items[0].updateError).toBeUndefined();
      canceled = false;
      await checkSourceUpdates(port, scripts, 100_000_001);
      expect(requests).toBe(2);
      expect(writes).toBe(1);
      expect(snapshot.items[0].pendingUpdate).toBeDefined();
    }
  }
});
