import { expect, test } from 'bun:test';
import { proceduralPerformanceFixture } from './helpers/procedural-performance';

test('procedural filtering does no idle work after its initial pass', async () => {
  const f = proceduralPerformanceFixture();
  try {
    f.frame();
    expect(f.metrics.matchedNodes).toBe(2000);
    f.reset();
    for (let i = 0; i < 60; i++) { f.frame(); f.fallback(); }
    expect(f.metrics.passes).toBe(0);
    expect(f.pending()).toEqual({ frames: 0, timers: 0 });
  } finally { await f.close(); }
});

test('a mutation burst coalesces into one pass and cancels the hidden-page fallback', async () => {
  const f = proceduralPerformanceFixture();
  try {
    f.frame(); f.reset();
    for (let i = 0; i < 1000; i++) f.mutate('class');
    expect(f.pending()).toEqual({ frames: 1, timers: 1 });
    f.frame(); f.fallback();
    expect(f.metrics.passes).toBe(1);
    expect(f.metrics.queries).toBe(1);
    expect(f.pending()).toEqual({ frames: 0, timers: 0 });
  } finally { await f.close(); }
});

test('own marker writes do not loop, but removal schedules restoration', async () => {
  const f = proceduralPerformanceFixture(10);
  try {
    f.frame(); f.reset();
    const card = f.document.querySelector('.card')!;
    const marker = card.getAttributeNames().find(name => name.startsWith('data-derpbird-'))!;
    expect(marker).toBeDefined();
    f.mutate(marker, card); f.frame();
    expect(f.metrics.passes).toBe(0);
    card.removeAttribute(marker);
    f.mutate(marker, card); f.frame();
    expect(card.getAttribute(marker)).toBe('');
    expect(f.metrics.passes).toBe(1);
  } finally { await f.close(); }
});

test('hidden-page fallback runs once, and disabled filtering performs no scan', async () => {
  const f = proceduralPerformanceFixture(10);
  try {
    f.fallback(); f.frame();
    expect(f.metrics.passes).toBe(1);
    f.reset(); f.setEnabled(false); f.mutate('class'); f.fallback(); f.frame();
    expect(f.metrics.queries).toBe(0);
    expect(f.pending()).toEqual({ frames: 0, timers: 0 });
  } finally { await f.close(); }
});

test('documents with no procedural rules schedule no filtering work', async () => {
  const f = proceduralPerformanceFixture(10, 0);
  try {
    f.mutate('class'); f.frame(); f.fallback();
    expect(f.metrics.passes).toBe(0);
    expect(f.pending()).toEqual({ frames: 0, timers: 0 });
  } finally { await f.close(); }
});


test('unrelated attributes trigger no scans or marker writes', async () => {
  const f = proceduralPerformanceFixture(2000, 20);
  try {
    f.frame(); f.reset();
    for (let i = 0; i < 30; i++) { f.mutate('data-clock'); f.frame(); f.fallback(); }
    expect(f.metrics).toEqual({ passes: 0, queries: 0, matchedNodes: 0, markerWrites: 0 });
  } finally { await f.close(); }
});

test('relevant changes reevaluate without rewriting intact markers', async () => {
  const f = proceduralPerformanceFixture(20);
  try {
    f.frame(); f.reset();
    f.mutate('class'); f.frame();
    expect(f.metrics.queries).toBe(1);
    expect(f.metrics.markerWrites).toBe(0);
  } finally { await f.close(); }
});


test('attribute selectors retain conservative invalidation and restore matches', async () => {
  const f = proceduralPerformanceFixture(2, 1, [{ selector: [
    { type: 'css-selector', arg: '.card[data-visible="yes"]' },
    { type: 'has-text', arg: 'Sponsored' },
  ] }]);
  try {
    f.frame(); f.reset();
    const card = f.document.querySelector('.card')!;
    card.setAttribute('data-visible', 'yes'); f.mutate('data-visible', card); f.frame();
    expect(f.metrics.matchedNodes).toBe(1);
    const markers = card.getAttributeNames().filter(name => name.startsWith('data-derpbird-'));
    expect(markers.length).toBe(2);
    card.removeAttribute('data-visible'); f.mutate('data-visible', card); f.frame();
    expect(markers.some(name => !card.hasAttribute(name))).toBe(true);
  } finally { await f.close(); }
});


test('text changes reevaluate only affected subjects and update ancestor matches', async () => {
  const f = proceduralPerformanceFixture(2000, 20);
  try {
    f.frame(); f.reset();
    const card = f.document.querySelector('.card')!;
    const marker = card.getAttributeNames().find(name => name.startsWith('data-derpbird-'))!;
    card.textContent = 'Organic';
    f.records([{ type: 'childList', target: card, addedNodes: [...card.childNodes], removedNodes: [] }]); f.frame();
    expect(card.hasAttribute(marker)).toBe(false);
    expect(f.metrics.matchedNodes).toBe(0);
    const text = card.firstChild!; text.textContent = 'Sponsored again';
    f.records([{ type: 'characterData', target: text }]); f.frame();
    expect(card.getAttribute(marker)).toBe('');
    expect(f.metrics.matchedNodes).toBe(1);
  } finally { await f.close(); }
});

test('incremental filtering handles added, moved, removed and newly matching subjects', async () => {
  const f = proceduralPerformanceFixture(2);
  try {
    f.frame();
    const parent = f.document.createElement('div'); parent.className = 'card';
    const child = f.document.createElement('div'); child.className = 'card'; child.textContent = 'Sponsored'; parent.append(child);f.document.body.append(parent);
    f.records([{ type: 'childList', target: f.document.body, addedNodes: [parent], removedNodes: [] }]);f.frame();
    const marker = child.getAttributeNames().find(name => name.startsWith('data-derpbird-'))!;
    expect(parent.hasAttribute(marker)).toBe(true);
    child.remove();
    f.records([{ type: 'childList', target: parent, addedNodes: [], removedNodes: [child] }]);f.frame();
    expect(parent.hasAttribute(marker)).toBe(false); expect(child.hasAttribute(marker)).toBe(false);
    child.className = 'other';f.document.body.append(child);
    f.records([{ type: 'childList', target: f.document.body, addedNodes: [child], removedNodes: [] }]);f.frame();
    expect(child.hasAttribute(marker)).toBe(false);
    child.className = 'card';f.mutate('class', child);f.frame();expect(child.hasAttribute(marker)).toBe(true);
    child.className = 'other';f.mutate('class', child);f.frame();expect(child.hasAttribute(marker)).toBe(false);
  } finally { await f.close(); }
});

test('attribute mutations execute only rules that depend on that attribute', async () => {
  const f = proceduralPerformanceFixture(2, 2, [
    { selector: [{ type: 'css-selector', arg: '.card' }, { type: 'has-text', arg: 'Sponsored' }] },
    { selector: [{ type: 'css-selector', arg: '#clock' }, { type: 'has-text', arg: 'Sponsored' }] },
  ]);
  try {
    f.frame(); f.reset();
    f.mutate('class', f.document.querySelector('.card')!); f.frame();
    expect(f.metrics.queries).toBe(1);
  } finally { await f.close(); }
});

test('adopting a matched node into another document removes cached styling', async () => {
  const f = proceduralPerformanceFixture(1);
  try {
    f.frame();
    const card = f.document.querySelector('.card')!;
    const marker = card.getAttributeNames().find(name => name.startsWith('data-derpbird-'))!;
    const other = f.document.implementation.createHTMLDocument(); other.body.append(other.adoptNode(card));
    expect(card.isConnected).toBe(true);
    f.records([{ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [card] }]); f.frame();
    expect(card.hasAttribute(marker)).toBe(false);
  } finally { await f.close(); }
});
