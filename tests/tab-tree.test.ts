import { describe, expect, test } from 'bun:test';
import { canDropTab, tabDropPlacement } from '../src/browser/tab-tree';
import { decodeSnapshot, type Tab } from '../src/browser/protocol';
const tab = (id: string, parentId?: string): Tab => ({ id, parentId, url: 'about:blank', title: id, loading: false, canGoBack: false, canGoForward: false, pinned: false, audible: false, muted: false, private: false });
const tabs = [tab('a'), tab('b', 'a'), tab('c', 'a'), tab('d'), tab('e')];
const snapshot = (items: Tab[]) => ({ version: 1, revision: 1, preferences: { layout: 'vertical', compact: false }, tabs: items, activeTabId: items[0]!.id });
describe('two-level tab groups', () => {
  test('drop zones distinguish ordering from grouping', () => {
    expect([tabDropPlacement(2, 28), tabDropPlacement(14, 28), tabDropPlacement(26, 28)]).toEqual(['before', 'inside', 'after']);
  });
  test('leaf can join, leave and reorder between groups', () => {
    expect(canDropTab(tabs, 'd', 'a', 'inside')).toBe(true);
    expect(canDropTab(tabs, 'b', 'a', 'after')).toBe(true);
    expect(canDropTab(tabs, 'b', 'c', 'before')).toBe(true);
    expect(canDropTab(tabs, 'b', 'd', 'inside')).toBe(true);
  });
  test('group moves as a unit and cannot become a third level or contain itself', () => {
    expect(canDropTab(tabs, 'a', 'd', 'after')).toBe(true);
    expect(canDropTab(tabs, 'a', 'd', 'inside')).toBe(false);
    expect(canDropTab(tabs, 'a', 'b', 'before')).toBe(false);
    expect(canDropTab(tabs, 'a', 'a', 'inside')).toBe(false);
    expect(canDropTab([{ ...tab('p'), pinned: true }, ...tabs], 'p', 'a', 'inside')).toBe(false);
  });
  test('native snapshots reject cycles, orphans, extra levels and split groups', () => {
    expect(decodeSnapshot(snapshot(tabs)).tabs[1]!.parentId).toBe('a');
    for (const items of [[tab('a', 'a')], [tab('a'), tab('b', 'missing')], [tab('a'), tab('b', 'a'), tab('c', 'b')], [tab('a'), tab('d'), tab('b', 'a')]])
      expect(() => decodeSnapshot(snapshot(items))).toThrow('Invalid tab tree');
  });
});
