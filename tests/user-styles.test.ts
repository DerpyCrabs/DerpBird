import { describe, expect, test } from 'bun:test';
import { parseStyleConditions, parseUserStyle, StyleImportError } from '../src/browser/user-styles';

describe('Stylish Mozilla-format import', () => {
  test('preserves global and scoped cascade order and nested CSS', () => {
    const sections = parseUserStyle(`body { color: red }
      @-moz-document domain("example.com"), url-prefix(https://example.org/) {
        @media (width > 1px) { body { color: green; --text: "} @-moz-document" } }
      }
      body { color: blue }`);
    expect(sections).toHaveLength(3);
    expect(sections[0].conditions).toEqual([]);
    expect(sections[1].conditions).toEqual([
      { type: 'domain', value: 'example.com' }, { type: 'url-prefix', value: 'https://example.org/' },
    ]);
    expect(sections[1].css).toContain('@media');
    expect(sections[1].css).toContain('--text: "} @-moz-document"');
    expect(sections[2].css).toContain('color: blue');
  });
  test('decodes CSS quoting once, including regexp escapes and hexadecimal escapes', () => {
    expect(parseStyleConditions(String.raw`regexp("https://example\\.com/.*"), domain('ex\61 mple.org')`)).toEqual([
      { type: 'regexp', value: String.raw`https://example\.com/.*` },
      { type: 'domain', value: 'example.org' },
    ]);
    expect(parseStyleConditions('url("https://example.com/a,b)c") /* note */ , url-prefix()')).toEqual([
      { type: 'url', value: 'https://example.com/a,b)c' }, { type: 'url-prefix', value: '' },
    ]);
  });
  test('retains namespace semantics in scoped sections', () => {
    const sections = parseUserStyle('@namespace svg url(http://www.w3.org/2000/svg); @-moz-document domain("example.com") { svg|rect { fill: red } }');
    expect(sections).toHaveLength(1);
    expect(sections[0].css).toContain('@namespace svg url(http://www.w3.org/2000/svg);');
    expect(sections[0].css).toContain('svg|rect');
    const global = parseUserStyle('@import "theme.css"; @namespace svg url(http://www.w3.org/2000/svg); svg|rect { fill: red }')[0].css;
    expect(global.indexOf('@import')).toBeLessThan(global.indexOf('@namespace'));
  });
  test('accepts hexadecimal escapes in unquoted values and quoted line continuations', () => {
    expect(parseStyleConditions(String.raw`domain(ex\61 mple.com)`)[0].value).toBe('example.com');
    expect(parseStyleConditions('domain("exa\\\r\nmple.com")')[0].value).toBe('example.com');
  });
  test('does not interpret conditions in CSS strings and comments', () => {
    expect(parseUserStyle('/* @-moz-document domain("evil") { */ body::after {content: "@-moz-document {}"}')[0].conditions).toEqual([]);
  });
  test('fails closed on malformed or unsupported restrictions', () => {
    for (const condition of ['', 'domain("*.example.com")', 'domain("https://example.com")', 'hostname("example.com")', 'domain("example.com"),', 'domain("example.com") url("a")', 'url("unclosed)', 'url(a b)'])
      expect(() => parseStyleConditions(condition)).toThrow(StyleImportError);
    for (const css of ['@-moz-document domain("example.com");', 'body {', '/* only a comment */'])
      expect(() => parseUserStyle(css)).toThrow(StyleImportError);
    expect(() => parseUserStyle(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(StyleImportError);
  });
});

test('nested document restrictions intersect and preserve conditional wrappers and cascade order', () => {
  const sections = parseUserStyle(`@media screen {
    body { color:red }
    @-moz-document domain("example.com"), domain("example.org") {
      body { color:green }
      @supports (display: grid) {
        @-moz-document url-prefix("https://example.com/private/") { body { color:blue } }
      }
      body { color:purple }
    }
    body { color:black }
  }`);
  expect(sections).toHaveLength(5);
  expect(sections.every(section => section.css.includes('@media screen'))).toBe(true);
  expect(sections.map(section => section.conditions.length)).toEqual([0, 2, 2, 2, 0]);
  expect(sections[2].conditionGroups).toEqual([[{ type: 'url-prefix', value: 'https://example.com/private/' }]]);
  expect(sections[2].css).toContain('@supports');
  expect(sections[2].css).toContain('color:blue');
  expect(sections[3].css).toContain('color:purple');
  expect(sections[4].css).toContain('color:black');
  expect(sections.every(section => !section.css.includes('@-moz-document'))).toBe(true);
});

test('rejects document scope expansion beyond registry limits', () => {
  expect(() => parseUserStyle('@-moz-document domain("example.com") {'.repeat(33) + 'body{}' + '}'.repeat(33))).toThrow(StyleImportError);
  expect(() => parseUserStyle('@-moz-document domain("example.com") {body{}}'.repeat(1025))).toThrow(StyleImportError);
});

test('named layers retain their position even when a document scope does not match', () => {
  const sections = parseUserStyle(`@layer theme {
    @-moz-document domain("example.com") { body { color: red } }
  }
  @layer overrides { body { color: blue } }
  @layer theme { body { color: green } }`);
  const unrelated = sections.filter(section => !section.conditions.length).map(section => section.css).join('\n');
  expect(unrelated.indexOf('@layer theme')).toBeLessThan(unrelated.indexOf('@layer overrides'));
  expect(unrelated).not.toContain('color: red');
  expect(unrelated).toContain('color: green');
  const scoped = sections.find(section => section.conditions.length)!;
  expect(scoped.conditions).toEqual([{ type: 'domain', value: 'example.com' }]);
  expect(scoped.css).toContain('@layer theme');
  expect(scoped.css).toContain('color: red');
});

test('nested named layers keep conditional ancestors and document restrictions', () => {
  const sections = parseUserStyle(`@media screen { @layer theme {
    @layer colors { @-moz-document domain("example.com") { body { color: red } } }
  } }`);
  expect(sections.every(section => section.css.includes('@media screen'))).toBe(true);
  const scoped = sections.find(section => section.conditions.length)!;
  expect(scoped.css).toContain('@layer theme');
  expect(scoped.css).toContain('@layer colors');

});

// Reconstruct the native wire format to inspect the resulting CSS tree, rather
// than merely asserting that the importer accepts previously rejected input.
function selectedSheet(source: string, domain: string): string {
  const sections = parseUserStyle(source);
  let ancestors: NonNullable<(typeof sections)[number]['wrappers']> = [];
  let result = '';
  for (const section of sections) {
    const groups = [section.conditions, ...(section.conditionGroups ?? [])];
    if (!groups.every(group => !group.length || group.some(condition => condition.value === domain))) continue;
    const wrappers = section.wrappers ?? [];
    let common = 0;
    while (common < ancestors.length && common < wrappers.length && ancestors[common].id === wrappers[common].id) common++;
    result += '}\n'.repeat(ancestors.length - common);
    result += wrappers.slice(common).map(wrapper => wrapper.open + '\n').join('');
    result += section.css + '\n';
    ancestors = wrappers;
  }
  return result + '}\n'.repeat(ancestors.length);
}

test('anonymous layers and selector parents preserve identity, declaration order and restrictions', async () => {
  const { parse } = await import('postcss');
  const source = `@namespace svg url(http://www.w3.org/2000/svg);
    @layer { body { color:red; @-moz-document domain("match") { color:green } color:blue } }
    @layer { @-moz-document domain("other") { svg|rect { fill:black } } }`;
  for (const domain of ['match', 'other', 'none']) {
    const css = selectedSheet(source, domain);
    const root = parse(css);
    const layers = root.nodes.filter(node => node.type === 'atrule' && node.name === 'layer');
    expect(layers).toHaveLength(2);
    expect(root.nodes[0].type).toBe('atrule');
    expect(css.includes('color:green')).toBe(domain === 'match');
    expect(css.includes('fill:black')).toBe(domain === 'other');
    expect(css.indexOf('color:red')).toBeLessThan(css.indexOf('color:blue'));
    let bodies = 0;
    root.walkRules('body', () => { bodies++; });
    expect(bodies).toBe(1);
  }
});

test('keyframes retain a single definition and nested conditions do not escape it', async () => {
  const { parse } = await import('postcss');
  const source = `@keyframes pulse { from { opacity:0 }
    @-moz-document domain("match") { to { opacity:1; @-moz-document domain("other") { color:red } } }
  }`;
  const matched = parse(selectedSheet(source, 'match'));
  expect(matched.nodes).toHaveLength(1);
  expect(matched.toString()).toContain('opacity:1');
  expect(matched.toString()).not.toContain('color:red');
  expect(selectedSheet(source, 'none')).not.toContain('opacity:1');
  expect(matched.nodes[0].type === 'atrule' && matched.nodes[0].nodes?.length).toBe(2);
});
