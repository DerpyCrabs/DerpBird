import { test, expect } from 'bun:test';
import { decodeStyleSnapshot, decodeStyleMatchStatus } from '../src/browser/style-protocol';

const item = () => ({ id: 'one', name: 'Example', enabled: true, source: 'body{}', sections: [{ conditions: [{ type: 'domain' as const, value: 'example.com' }], css: 'body{}' }] });
test('decodes immutable style snapshots without evaluating CSS or regexes', () => {
  const input = { revision: 4, items: [item()] };
  const decoded = decodeStyleSnapshot(input);
  expect(decoded).toEqual(input);
  input.items[0].sections[0].conditions[0].value = 'changed';
  expect(decoded.items[0].sections[0].conditions[0].value).toBe('example.com');
  expect(Object.isFrozen(decoded.items[0].sections[0].conditions)).toBe(true);
});
test('rejects malformed snapshots and missing scope rather than treating it as global', () => {
  for (const input of [null, {}, { revision: -1, items: [] }, { revision: 1.5, items: [] },
    { revision: 1, items: [item(), item()] },
    { revision: 1, items: [{ ...item(), sections: [{ css: 'body{}' }] }] },
    { revision: 1, items: [{ ...item(), enabled: 'yes' }] },
    { revision: 1, items: [{ ...item(), sections: [{ css: 'body{}', conditions: [{ type: 'unknown', value: '' }] }] }] }])
    expect(() => decodeStyleSnapshot(input)).toThrow();
});

test('preserves bounded remote style dependencies and rejects local or authenticated imports', () => {
  const imports = { 'https://styles.example/lib.less': { url: 'https://cdn.example/lib.less', source: '@color: red;' } };
  const decoded = decodeStyleSnapshot({ revision: 1, items: [{ ...item(), imports }] });
  expect(decoded.items[0].imports).toEqual(imports);
  imports['https://styles.example/lib.less'].source = 'changed';
  expect(decoded.items[0].imports?.['https://styles.example/lib.less'].source).toBe('@color: red;');
  for (const url of ['file:///etc/passwd', 'https://user:password@example.com/lib.less'])
    expect(() => decodeStyleSnapshot({ revision: 1, items: [{ ...item(), imports: { [url]: { url, source: '' } } }] })).toThrow();
});


test('decodes bounded immutable style matching diagnostics', () => {
  const input = { revision: 3, url: 'https://example.com/', evaluated: true, skippedConditions: 2, styleIds: ['one'] };
  const status = decodeStyleMatchStatus(input);
  input.styleIds.push('two');
  expect(status.styleIds).toEqual(['one']);
  expect(Object.isFrozen(status.styleIds)).toBe(true);
  for (const invalid of [null, {}, { ...input, skippedConditions: -1 }, { ...input, skippedConditions: 1025 },
    { ...input, revision: 0.5 }, { ...input, styleIds: ['one', 'one'] }, { ...input, evaluated: 'yes' }])
    expect(() => decodeStyleMatchStatus(invalid)).toThrow();
});


test('retains immutable conjunctive style groups and rejects malformed restrictions', () => {
  const groups = [[{ type: 'url-prefix', value: 'https://example.com/private/' }]];
  const decoded = decodeStyleSnapshot({ revision: 1, items: [{ ...item(), sections: [{ ...item().sections[0], conditionGroups: groups }] }] });
  groups[0][0].value = 'changed';
  expect(decoded.items[0].sections[0].conditionGroups?.[0][0].value).toBe('https://example.com/private/');
  expect(Object.isFrozen(decoded.items[0].sections[0].conditionGroups?.[0])).toBe(true);
  for (const conditionGroups of [null, {}, [null], [[]], [[{ type: 'unknown', value: '' }]], Array(32).fill([{ type: 'domain', value: 'example.com' }])])
    expect(() => decodeStyleSnapshot({ revision: 1, items: [{ ...item(), sections: [{ ...item().sections[0], conditionGroups }] }] })).toThrow();
});

test('structural style ancestors survive IPC and reject malformed or excessive payloads', () => {
  const snapshot = (wrappers: unknown) => ({ revision: 1, items: [{ ...item(), sections: [{ css: 'color:red;', conditions: [], wrappers }] }] });
  const wrappers = [{ id: 1, open: '@layer {' }, { id: 2, open: 'body {' }];
  expect(decodeStyleSnapshot(snapshot(wrappers)).items[0].sections[0].wrappers).toEqual(wrappers);
  expect(decodeStyleSnapshot(snapshot([])).items[0].sections[0].wrappers).toEqual([]);
  for (const bad of [null, {}, [{ id: 0, open: '{' }], [{ id: 1.1, open: '{' }], [{ id: 1, open: null }],
    Array(33).fill(wrappers[0]), [{ id: 1, open: ' '.repeat(2 * 1024 * 1024) }]])
    expect(() => decodeStyleSnapshot(snapshot(bad))).toThrow();
});
