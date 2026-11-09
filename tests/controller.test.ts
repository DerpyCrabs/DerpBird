import { expect, test } from 'bun:test';
import { createController } from '../src/browser/controller';
import type { Command, NativePort } from '../src/browser/protocol';
import { snapshot } from './protocol.test';
function fixture() {
  let listener: ((value: unknown) => void) | undefined;
  let unsubscribed = false;
  const commands: Command[] = [];
  let resolve!: (value: unknown) => void;
  const initial = new Promise(resolve_ => { resolve = resolve_; });
  const port: NativePort = {
    version: 1,
    request: async command => { commands.push(command); },
    snapshot: () => initial,
    subscribe: callback => { listener = callback; return () => { unsubscribed = true; }; },
  };
  return { port, commands, emit: (value: unknown) => listener?.(value), resolve, unsubscribed: () => unsubscribed };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
test('newer events win over the initial snapshot race', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot(3)); f.resolve(snapshot(1)); await settle();
    expect(c.state().browser.revision).toBe(3);
    f.emit(snapshot(2)); expect(c.state().browser.revision).toBe(3);
  } finally { await c.close(); }
});
test('commands wait for authoritative native state; stale data cannot fabricate tabs', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot());
    c.send({ type: 'tab.close', tabId: 'a' }); await settle();
    expect(f.commands).toEqual([{ type: 'tab.close', tabId: 'a' }]);
    expect(c.state().browser.tabs).toHaveLength(1);
    f.emit({ ...snapshot(2), tabs: [], activeTabId: null });
    expect(c.state().browser.tabs).toHaveLength(0);
  } finally { await c.close(); }
});
test('unchanged tab objects survive snapshots and layout changes', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot()); const tab = c.state().browser.tabs[0];
    f.emit(snapshot(2)); c.setLayout('horizontal');
    expect(c.state().browser.tabs[0]).toBe(tab);
  } finally { await c.close(); }
});
test('invalid native updates do not replace the last valid snapshot', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot()); f.emit({ version: 10 });
    expect(c.state().browser.revision).toBe(1);
    expect(c.state().error).toBeTruthy();
  } finally { await c.close(); }
});
test('teardown unsubscribes and ignores late events', async () => {
  const f = fixture(); const c = createController(f.port);
  f.emit(snapshot()); await c.close();
  f.emit(snapshot(2)); f.resolve(snapshot(3)); await settle();
  expect(f.unsubscribed()).toBe(true);
  expect(c.state().browser.revision).toBe(1);
});
test('offline commands are explicit errors', async () => {
  const c = createController();
  try { c.navigate('example.com'); expect(c.state().connected).toBe(false); expect(c.state().error).toContain('Browser connection unavailable'); }
  finally { await c.close(); }
});
test('serializes native commands even when acknowledgements are delayed', async () => {
  const f = fixture();
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const commands: Command[] = [];
  const c = createController({ ...f.port, request: async command => {
    commands.push(command);
    if (commands.length === 1) await first;
  } });
  try {
    f.emit(snapshot());
    c.send({ type: 'tab.navigate', tabId: 'a', url: 'https://first.example/' });
    c.send({ type: 'tab.close', tabId: 'a' });
    await settle(); expect(commands).toHaveLength(1);
    release(); await settle(); expect(commands.map(command => command.type)).toEqual(['tab.navigate', 'tab.close']);
  } finally { release(); await c.close(); }
});
test('opens browser services through the native host and dismisses the menu', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot()); c.setPanel('menu'); c.openPage('history');
    expect(c.state().panel).toBe(null);
    await settle();
    expect(f.commands).toEqual([{ type: 'browser.open-page', page: 'history' }]);
    expect(c.state().browser.tabs).toHaveLength(1);
  } finally { await c.close(); }
});
test('context actions target the selected menu tab, not the active tab', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    const first = snapshot();
    f.emit({ ...first, tabs: [...first.tabs, { ...first.tabs[0]!, id: 'b' }] });
    c.openTabMenu('b', 10, 20); c.tabMenuAction('pin'); await settle();
    expect(f.commands).toEqual([{ type: 'tab.pin', tabId: 'b', value: true }]);
    expect(c.state().browser.tabs[1]?.pinned).toBe(false);
    expect(c.state().tabMenu).toBe(null);
  } finally { await c.close(); }
});
test('closing a tab through native state invalidates its open menu', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot()); c.openTabMenu('a', 10, 20);
    f.emit({ ...snapshot(2), tabs: [], activeTabId: null });
    expect(c.state().tabMenu).toBe(null);
    c.tabMenuAction('close'); await settle(); expect(f.commands).toHaveLength(0);
  } finally { await c.close(); }
});
test('reordering respects pinned groups and list boundaries', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    const first = snapshot();
    f.emit({ ...first, tabs: [{ ...first.tabs[0]!, pinned: true }, { ...first.tabs[0]!, id: 'b' }, { ...first.tabs[0]!, id: 'c' }] });
    c.openTabMenu('b', 0, 0); c.tabMenuAction('previous');
    c.openTabMenu('c', 0, 0); c.tabMenuAction('next');
    c.openTabMenu('b', 0, 0); c.tabMenuAction('next'); await settle();
    expect(f.commands).toEqual([{ type: 'tab.move', tabId: 'b', index: 2 }]);
  } finally { await c.close(); }
});

 test('preferences follow native profile snapshots and reject stale updates', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot());
    c.setLayout('horizontal'); await settle();
    expect(f.commands).toEqual([{ type: 'shell.set-layout', layout: 'horizontal' }]);
    expect(c.state().layout).toBe('vertical');
    f.emit({ ...snapshot(3), preferences: { layout: 'horizontal', compact: true } });
    expect(c.state().layout).toBe('horizontal'); expect('compact' in c.state()).toBe(false);
    f.emit(snapshot(2)); expect(c.state().layout).toBe('horizontal');
  } finally { await c.close(); }
});

test('empty address submission preserves the active page without a native request', async () => {
  const f = fixture(); const c = createController(f.port);
  try {
    f.emit(snapshot());
    c.navigate('   '); await settle();
    expect(f.commands).toEqual([]);
    expect(c.state().error).toBeNull();
  } finally { await c.close(); }
});

test('native command failures retain the actionable host error', async () => {
  const f = fixture();
  const c = createController({ ...f.port, request: async () => { throw new Error('Tab is no longer available'); } });
  try {
    f.emit(snapshot());
    c.send({ type: 'tab.close', tabId: 'a' }); await settle();
    expect(c.state().error).toBe('Tab is no longer available');
  } finally { await c.close(); }
});

test('address results ignore stale queries and do not reopen a previous edit', async () => {
  const f = fixture(); const c = createController(f.port);
  const items = [{ text: 'https://example.com/', title: 'Example' }];
  try {
    f.emit(snapshot());
    c.editAddress('e');
    const first = c.state().addressQuery;
    f.emit({ ...snapshot(2), addressSuggestions: { query: first, items } });
    expect(c.state().browser.addressSuggestions?.items).toEqual(items);
    c.editAddress('ex');
    const second = c.state().addressQuery;
    f.emit({ ...snapshot(3), addressSuggestions: { query: first, items: [] } });
    expect(c.state().browser.addressSuggestions?.items).toEqual(items);
    f.emit({ ...snapshot(4), addressSuggestions: { query: second, items: [] } });
    expect(c.state().browser.addressSuggestions?.items).toEqual([]);
    c.blurAddress();
    c.editAddress('different');
    expect(c.state().browser.addressSuggestions).toBeUndefined();
    f.emit({ ...snapshot(5), addressSuggestions: { query: second, items } });
    expect(c.state().browser.addressSuggestions).toBeUndefined();
  } finally { await c.close(); }
});

test('local suggestions start immediately and coalesce queued edits independently of navigation', async () => {
  const f = fixture();
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  f.port.request = async command => {
    f.commands.push(command);
    if (command.type === 'browser.suggest' && command.input === 'e') await first;
  };
  const c = createController(f.port);
  try {
    f.emit(snapshot()); c.editAddress('e'); await settle();
    expect(f.commands).toEqual([{ type: 'browser.suggest', input: 'e', query: c.state().addressQuery }]);
    c.editAddress('ex'); c.editAddress('exa'); c.editAddress('example');
    c.send({ type: 'tab.reload', tabId: 'a' }); await settle();
    expect(f.commands.at(-1)?.type).toBe('tab.reload');
    release(); await settle();
    expect(f.commands.filter(command => command.type === 'browser.suggest').map(command => command.input)).toEqual(['e', 'example']);
  } finally { release(); await c.close(); }
});
