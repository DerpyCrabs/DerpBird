import { describe, expect, test } from 'bun:test';
import { decodeSnapshot, navigationTarget } from '../src/browser/protocol';
const tab = { id: 'a', url: 'https://example.com/', title: 'Example', loading: false, canGoBack: false, canGoForward: false, pinned: false, audible: false, muted: false, private: false };
export const snapshot = (revision = 1) => ({ version: 1 as const, revision, preferences: { layout: 'vertical' as const, compact: false }, tabs: [tab], activeTabId: 'a' });
describe('native boundary', () => {
  test('copies and freezes native input', () => {
    const input = snapshot();
    const result = decodeSnapshot(input);
    expect(result.tabs[0]).not.toBe(input.tabs[0]);
    expect(Object.isFrozen(result.tabs[0])).toBe(true);
  });
  test('rejects duplicate ids', () => { expect(() => decodeSnapshot({ ...snapshot(), tabs: [tab, tab] })).toThrow(); });
  test('rejects missing active tabs', () => { expect(() => decodeSnapshot({ ...snapshot(), activeTabId: 'missing' })).toThrow(); });
  test('rejects invalid versions and revisions', () => {
    for (const revision of [-1, NaN, Infinity, 1.5, '1']) expect(() => decodeSnapshot({ ...snapshot(), revision })).toThrow();
    expect(() => decodeSnapshot({ ...snapshot(), version: 2 })).toThrow();
  });
  test('rejects malformed boolean fields', () => { expect(() => decodeSnapshot({ ...snapshot(), tabs: [{ ...tab, private: 'false' }] })).toThrow(); });
  test('allows an empty window only with no active tab', () => {
    expect(decodeSnapshot({ ...snapshot(), tabs: [], activeTabId: null }).tabs).toHaveLength(0);
    expect(() => decodeSnapshot({ ...snapshot(), activeTabId: null })).toThrow();
  });
});
describe('address entry', () => {
  for (const [input, output] of [
    ['example.com', 'https://example.com/'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['[::1]:8080/a', 'https://[::1]:8080/a'],
    [' https://example.com/a?q=1 ', 'https://example.com/a?q=1'],
    ['file:///tmp/test.html', 'file:///tmp/test.html'],
    ['two words', 'https://duckduckgo.com/?q=two%20words'],
    ['что такое effect', 'https://duckduckgo.com/?q=%D1%87%D1%82%D0%BE%20%D1%82%D0%B0%D0%BA%D0%BE%D0%B5%20effect'],
    ['', 'about:blank'],
  ]) test(input || 'empty address', () => expect(navigationTarget(input!)).toBe(output!));
  test('rejects executable and internal schemes', () => {
    for (const input of ['javascript:alert(1)', 'data:text/html,test', 'derpbird:settings', 'about:config'])
      expect(() => navigationTarget(input)).toThrow();
  });
});
test('allows user-facing browser pages but never the privileged chrome', () => {
  for (const page of ['history', 'downloads', 'bookmarks', 'settings', 'version', 'newtab'])
    expect(navigationTarget(`about:${page}`)).toBe(`about:${page}`);
  expect(navigationTarget('about:settings#privacy')).toBe('about:settings#privacy');
  for (const url of ['about:derpbird', 'resource://ladybird/about-pages/derpbird.html'])
    expect(() => navigationTarget(url)).toThrow();
});

test('validates and detaches profile preferences', () => {
  for (const preferences of [undefined, null, {}, { layout: 'diagonal', compact: false }])
    expect(() => decodeSnapshot({ ...snapshot(), preferences })).toThrow();
  const input = snapshot(); const result = decodeSnapshot(input);
  expect(result.preferences).not.toBe(input.preferences);
  expect(Object.isFrozen(result.preferences)).toBe(true);
});

test('submission suggestions preserve source origin across navigation and reject secrets/private contexts', () => {
  const credentialProposal = { token: '00000000-0000-4000-8000-000000000001', origin: 'https://login.example', username: 'alice' };
  expect(decodeSnapshot({ ...snapshot(), credentialProposal }).credentialProposal).toEqual(credentialProposal);
  expect(() => decodeSnapshot({ ...snapshot(), credentialProposal: { ...credentialProposal, password: 'must-not-enter-shell' } })).toThrow();
  expect(() => decodeSnapshot({ ...snapshot(), credentialProposal, tabs: [{ ...tab, private: true }] })).toThrow();
  expect(() => decodeSnapshot({ ...snapshot(), credentialProposal, tabs: [], activeTabId: null })).toThrow();
});

test('script commands are bounded, detached and reject duplicate identities',()=>{
  const command={id:'menu1',script:'Example script',label:'Run action',title:'Tooltip',accessKey:'r',autoClose:false};
  const result=decodeSnapshot({...snapshot(),scriptCommands:[command]});
  expect(result.scriptCommands?.[0]).toEqual(command);
  expect(result.scriptCommands?.[0]).not.toBe(command);
  expect(Object.isFrozen(result.scriptCommands?.[0])).toBe(true);
  for(const commands of [[command,command],[{...command,autoClose:'no'}],[{...command,label:''}],Array(257).fill(command)])
    expect(()=>decodeSnapshot({...snapshot(),scriptCommands:commands})).toThrow();
});


test('blocking journal is bounded and belongs to the active tab', () => {
  const blockingLog = { tabId: 'a', entries: [{ id: 1, url: 'https://tracker.example/pixel', kind: 'Image' }] };
  expect(decodeSnapshot({ ...snapshot(), blockingLog }).blockingLog).toEqual(blockingLog);
  for (const invalid of [ { ...blockingLog, tabId: 'b' }, { ...blockingLog, entries: Array(129).fill(blockingLog.entries[0]) }, { ...blockingLog, entries: [blockingLog.entries[0], blockingLog.entries[0]] } ])
    expect(() => decodeSnapshot({ ...snapshot(), blockingLog: invalid })).toThrow();
});


test('blocking rule text is bounded and detached', () => {
  const entry = { id: 1, url: 'https://tracker.example', kind: 'Script', rule: '||tracker.example^$script' };
  const value = { ...snapshot(), blockingLog: { tabId: 'a', entries: [entry] } };
  expect(decodeSnapshot(value).blockingLog?.entries[0]?.rule).toBe(entry.rule);
  for (const rule of [false, {}, 'x'.repeat(4097)])
    expect(() => decodeSnapshot({ ...value, blockingLog: { tabId: 'a', entries: [{ ...entry, rule }] } })).toThrow();
});

test('legacy compact preference is ignored', () => {
  expect(decodeSnapshot({ ...snapshot(), preferences: { layout: 'vertical', compact: true } }).preferences).toEqual({ layout: 'vertical' });
});

 test('history suggestion icons accept bounded inline PNGs and reject remote or malformed sources', () => {
  const decode = (favicon: unknown) => decodeSnapshot({ ...snapshot(), addressSuggestions: { query: 1, items: [{ text: 'https://example.com/', title: 'Example', source: 'history', favicon }] } });
  expect(decode('data:image/png;base64,YQ==').addressSuggestions?.items[0].favicon).toBe('data:image/png;base64,YQ==');
  for (const icon of ['https://example.com/favicon.ico', 'data:image/svg+xml;base64,YQ==', 3, 'data:image/png;base64,' + 'A'.repeat(16384)]) expect(() => decode(icon)).toThrow();
});

test('autofill suggestions carry only metadata for one origin and reject private or malformed snapshots', () => {
  const item = { id: 'entry', origin: 'https://example.com', username: 'alice', revision: '1' };
  const suggestion = { token: '3', origin: item.origin, x: 40, y: 80, items: [item] };
  expect(decodeSnapshot({ ...snapshot(), credentialAutofill: suggestion }).credentialAutofill?.items).toEqual([item]);
  for (const change of [{ x: NaN }, { items: [{ ...item, password: 'secret' }] }, { items: [item, item] }, { origin: 'https://other.test' }, { password: 'secret' }])
    expect(() => decodeSnapshot({ ...snapshot(), credentialAutofill: { ...suggestion, ...change } })).toThrow();
  expect(() => decodeSnapshot({ ...snapshot(), tabs: [{ ...tab, private: true }], credentialAutofill: suggestion })).toThrow();
});

test('appearance preferences accept persisted values and reject malformed input', () => {
  for (const theme of ['dark', 'light'] as const) {
    const preferences = {layout: 'vertical' as const, theme, alwaysClose: false};
    expect(decodeSnapshot({...snapshot(), preferences}).preferences).toEqual(preferences);
  }
  for (const extra of [{theme: 'blue'}, {theme: null}, {alwaysClose: 'false'}, {alwaysClose: 0}])
    expect(() => decodeSnapshot({...snapshot(), preferences: {...snapshot().preferences, ...extra}})).toThrow();
});
