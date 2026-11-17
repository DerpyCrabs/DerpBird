import { expect, test } from 'bun:test';
import { decodeSnapshot } from '../src/browser/protocol';
import { shellTabLayout, tabUnits, splitEdge, splitRatio } from '../src/browser/splits';
const tab = (id: string) => ({ id, url: 'about:blank', title: id, loading: false, canGoBack: false, canGoForward: false, pinned: false, audible: false, muted: false, private: false });
const pair = { id: 'pair', firstTabId: 'c', secondTabId: 'a', axis: 'horizontal', ratio: .5 };
const fixture = { version: 1, revision: 1, preferences: { layout: 'vertical' }, activeTabId: 'a', tabs: ['a', 'b', 'c'].map(tab), splits: [pair] };
test('a pair occupies one tab position with page order independent of tab creation order', () => {
  const snapshot = decodeSnapshot(fixture);
  expect(tabUnits(snapshot).map(unit => unit.tabs.map(tab => tab.id))).toEqual([['c', 'a'], ['b']]);
  expect(Object.isFrozen(snapshot.splits![0])).toBe(true);
  expect(tabUnits(decodeSnapshot({ ...fixture, tabs: fixture.tabs.slice(0, 2), splits: [] })).map(unit => unit.tabs.map(tab => tab.id))).toEqual([['a'], ['b']]);
});
test('shell layout reuses an immutable snapshot and recomputes groups for its successor', () => {
  const first = decodeSnapshot({ ...fixture, splits: [], tabs: [tab('a'), { ...tab('b'), parentId: 'a' }] });
  const layout = shellTabLayout(first);
  expect(shellTabLayout(first)).toBe(layout);
  expect([...layout.parents]).toEqual(['a']);
  const next = decodeSnapshot({ ...fixture, activeTabId: 'b', splits: [], tabs: [{ ...tab('b'), pinned: true }] });
  expect(shellTabLayout(next).pinned.map(unit => unit.id)).toEqual(['b']);
  expect(shellTabLayout(next).parents.size).toBe(0);
});
test('native split snapshots reject dangling, repeated, pinned, private-mixed and malformed members', () => {
  for (const change of [{ firstTabId: 'missing' }, { secondTabId: 'c' }, { ratio: NaN }, { ratio: .1 }, { ratio: .81 }, { axis: 'diagonal' }])
    expect(() => decodeSnapshot({ ...fixture, splits: [{ ...pair, ...change }] })).toThrow();
  expect(() => decodeSnapshot({ ...fixture, splits: [pair, { ...pair, id: 'other' }] })).toThrow();
  for (const change of [{ pinned: true }, { private: true }])
    expect(() => decodeSnapshot({ ...fixture, tabs: [{ ...tab('a'), ...change }, tab('b'), tab('c')] })).toThrow();
});
test('edge drops distinguish all four directions from the center and outside the page', () => {
  expect([[5, 200], [795, 200], [400, 5], [400, 395], [400, 200], [-1, 200]].map(([x, y]) => splitEdge(x!, y!, 800, 400))).toEqual(['left', 'right', 'top', 'bottom', undefined, undefined]);
  expect(splitEdge(0, 0, 0, 0)).toBeUndefined();
});
test('divider uses the available page space and clamps both ends', () => {
  expect(splitRatio(400, 800)).toBe(.5);
  expect(splitRatio(-20, 800)).toBe(.2);
  expect(splitRatio(900, 800)).toBe(.8);
});

import { Window } from 'happy-dom';
import { observeSplitInteractions } from '../src/browser/splits';
import type { ShellController } from '../src/browser/controller';
import type { Command } from '../src/browser/protocol';

test('drag grouping suppresses its tab click without swallowing a subsequent menu click', async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<div class="tab-unit"><div class="tab"><button role="tab" data-tab-id="a">A</button></div></div><div class="tab-unit"><div class="tab"><button role="tab" data-tab-id="b">B</button></div></div><section id="content-surface"><div class="split-drag-surface" hidden></div></section><button id="menu">Menu action</button>';
  const a = document.querySelector('[data-tab-id="a"]')!;
  const b = document.querySelector('[data-tab-id="b"]')!;
  const row = b.parentElement!;
  row.getBoundingClientRect = () => new window.DOMRect(0, 30, 196, 28);
  document.elementFromPoint = () => b;
  const commands: Command[] = [];
  const browser = decodeSnapshot({ ...fixture, splits: [] });
  const stop = observeSplitInteractions(document as unknown as Document, { state: () => ({ browser, layout: 'vertical' } as ReturnType<ShellController['state']>), send: command => commands.push(command) });
  const pointer = (type: string, x: number, y: number) => new window.PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true, cancelable: true });
  try {
    a.dispatchEvent(pointer('pointerdown', 40, 14));
    b.dispatchEvent(pointer('pointermove', 40, 44));
    b.dispatchEvent(pointer('pointerup', 40, 44));
    expect(commands).toEqual([{ type: 'tab.tree-move', tabId: 'a', targetId: 'b', placement: 'inside' }]);
    const tabClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    b.dispatchEvent(tabClick); expect(tabClick.defaultPrevented).toBe(true);
    // A native page can consume the post-drag click instead of the shell.
    a.dispatchEvent(pointer('pointerdown', 40, 14)); b.dispatchEvent(pointer('pointermove', 40, 44)); b.dispatchEvent(pointer('pointerup', 40, 44));
    const menu = document.getElementById('menu')!;
    menu.addEventListener('pointerdown', event => event.stopPropagation());
    menu.dispatchEvent(pointer('pointerdown', 40, 80));
    const menuClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    menu.dispatchEvent(menuClick); expect(menuClick.defaultPrevented).toBe(false);
    expect(document.querySelector('.split-drag-surface')!.hasAttribute('hidden')).toBe(true);
  } finally { stop(); await window.happyDOM.close(); }
});
