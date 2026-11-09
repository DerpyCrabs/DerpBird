import { expect, test } from 'bun:test';
import { createStyleController, type StyleController } from '../src/browser/style-controller';
import type { StyleSnapshot, UserStylePort } from '../src/browser/style-protocol';

async function settled(controller: StyleController) {
  const deadline = Date.now() + 3000;
  while (controller.state().busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(controller.state().busy).toBe(false);
}
const initial = (): StyleSnapshot => ({ revision: 3, items: [{ id: 'one', name: 'Example', source: 'body { color: red }', enabled: true, sections: [{ conditions: [], css: 'body { color: red }' }] }] });

test('style editor preserves drafts on conflict and requires explicit discard before reload', async () => {
  let loads = 0;
  const port: UserStylePort = { list: async () => { loads++; return initial(); }, replace: async () => { throw new Error('Style conflict'); } };
  const controller = createStyleController(port);
  try {
    controller.load(); await settled(controller);
    controller.change({ source: 'body { color: blue }' });
    controller.save(); await settled(controller);
    expect(controller.state().dirty).toBe(true);
    expect(controller.state().draft?.source).toContain('blue');
    expect(controller.state().snapshot?.revision).toBe(3);
    expect(controller.state().error).toBe('Style conflict');
    controller.load();
    expect(loads).toBe(2);
    controller.discard();
    controller.load(); await settled(controller);
    expect(loads).toBe(3);
    expect(controller.state().dirty).toBe(false);
  } finally { await controller.close(); }
});

test('style editor parses before saving, publishes native revision, and blocks duplicate saves', async () => {
  let writes = 0;
  let finish: ((value: StyleSnapshot) => void) | undefined;
  let submitted: StyleSnapshot | undefined;
  const controller = createStyleController({ list: async () => initial(), replace: value => {
    writes++; submitted = value;
    return new Promise(resolve => { finish = resolve; });
  } });
  try {
    controller.load(); await settled(controller);
    controller.change({ source: '@-moz-document domain("example.com") { body { color: blue } }' });
    controller.save(); controller.save();
    const deadline = Date.now() + 3000;
    while (!finish && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    expect(writes).toBe(1);
    expect(submitted!.items[0].sections[0].conditions).toEqual([{ type: 'domain', value: 'example.com' }]);
    controller.change({ name: 'Should not replace pending draft' });
    expect(controller.state().draft?.name).toBe('Example');
    finish!({ ...submitted!, revision: 4 }); await settled(controller);
    expect(controller.state().snapshot?.revision).toBe(4);
    expect(controller.state().dirty).toBe(false);
    controller.change({ source: '@-moz-document invalid("x") { body{} }' });
    controller.save(); await settled(controller);
    expect(writes).toBe(1);
    expect(controller.state().dirty).toBe(true);
  } finally { await controller.close(); }
});

test('UserCSS editor exposes configured values and commits only successful compilation', async () => {
  let stored = initial();
  const controller = createStyleController({list:async()=>stored,replace:async value=>(stored={...value,revision:stored.revision+1})});
  try {
    controller.load(); await settled(controller);
    controller.change({source:'/* ==UserStyle==\n@name Configurable\n@namespace test\n@version 1.0.0\n@var color accent "Accent" #123456\n==/UserStyle== */\nbody{color:var(--accent)}'});
    controller.configure(); await settled(controller);
    expect(controller.state().configuration?.vars.accent.default).toBe('#123456');
    controller.changeVariable('accent','#abcdef');
    controller.save(); await settled(controller);
    expect(controller.state().snapshot?.items[0].sections[0].css).toContain('--accent:#abcdef');
    expect(controller.state().snapshot?.items[0].usercss?.values.accent).toBe('#abcdef');
    controller.configure(); await settled(controller);
    controller.resetVariables();
    controller.save(); await settled(controller);
    expect(controller.state().snapshot?.items[0].usercss?.values.accent).toBe('#123456');
  } finally { await controller.close(); }
});

test('style editor keeps dirty source on external changes and reloads only on explicit choice', async () => {
  let snapshot = initial();
  let writes = 0;
  const controller = createStyleController({ list: async () => snapshot, replace: async value => { writes++; return snapshot = { ...value, revision: value.revision + 1 }; } });
  try {
    controller.load(); await settled(controller);
    controller.change({ source: 'body { color: blue }' });
    snapshot = { revision: 4, items: [{ ...snapshot.items[0], source: 'body { color: green }' }] };
    controller.save(); await settled(controller);
    expect(writes).toBe(0);
    expect(controller.state().conflict).toBe(true);
    expect(controller.state().draft?.source).toContain('blue');
    controller.reloadLatest(); await settled(controller);
    expect(controller.state().draft?.source).toContain('green');
    expect(controller.state().dirty).toBe(false);
    expect(controller.state().conflict).toBe(false);
  } finally { await controller.close(); }
});


test('style status is read-only and stale registry diagnostics are rejected', async () => {
  let revision = 3;
  let writes = 0;
  const port: UserStylePort = {
    list: async () => initial(),
    replace: async snapshot => { writes++; return snapshot; },
    status: async () => ({ revision, url: 'https://example.com/', evaluated: true, skippedConditions: 1, styleIds: ['one'] }),
  };
  const controller = createStyleController(port);
  try {
    controller.load(); await settled(controller);
    controller.change({ source: 'body { color: blue }' });
    controller.refreshStatus(); await settled(controller);
    expect(controller.state().matchStatus?.styleIds).toEqual(['one']);
    expect(controller.state().dirty).toBe(true);
    expect(controller.state().draft?.source).toContain('blue');
    expect(writes).toBe(0);
    revision = 4;
    controller.refreshStatus(); await settled(controller);
    expect(controller.state().matchStatus).toBeNull();
    expect(controller.state().error).toContain('Стили изменились');
  } finally { await controller.close(); }
});


test('style URL download cancellation preserves the draft and allows a retry', async () => {
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let attempts = 0, writes = 0;
  const controller = createStyleController({
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
