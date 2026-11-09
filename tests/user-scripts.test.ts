import { expect, test } from 'bun:test';
import { parseUserScript, ScriptImportError } from '../src/browser/user-scripts';

const script = (metadata = '', body = '') => `// ==UserScript==\n// @name Example\n${metadata}\n// ==/UserScript==\n${body}`;

test('imports repeated restrictions, resources and dependencies without evaluating code', () => {
  const body = 'throw new Error("Never execute imported JavaScript");';
  const source = script(`// @namespace https://example.com/scripts
// @version 1.2.3
// @description Helpful tool
// @match https://*.example.com/*
// @match http://localhost/*
// @include /^https:\\/\\/example\\.org\\//
// @exclude https://example.com/private/*
// @exclude-match *://example.org/private/*
// @run-at document-start
// @grant GM.getValue
// @grant GM.xmlHttpRequest
// @connect api.example.com
// @noframes
// @require https://example.com/library.js#sha256=abc
// @require https://example.com/second.js
// @resource theme https://example.com/theme.css
// @name:ru Пример
// @future-feature keep this`, body);
  const parsed = parseUserScript(source);
  expect(parsed.name).toBe('Example');
  expect(parsed.runAt).toBe('document-start');
  expect(parsed.matches).toEqual(['https://*.example.com/*', 'http://localhost/*']);
  expect(parsed.includes).toEqual([String.raw`/^https:\/\/example\.org\//`]);
  expect(parsed.excludes).toEqual(['https://example.com/private/*']);
  expect(parsed.excludeMatches).toEqual(['*://example.org/private/*']);
  expect(parsed.grants).toEqual(['GM.getValue', 'GM.xmlHttpRequest']);
  expect(parsed.noFrames).toBe(true);
  expect(parsed.requires).toEqual(['https://example.com/library.js#sha256=abc', 'https://example.com/second.js']);
  expect(parsed.resources).toEqual([{ name: 'theme', url: 'https://example.com/theme.css' }]);
  expect(parsed.connects).toEqual(['api.example.com']);
  expect(parsed.entries).toContainEqual({ key: 'name:ru', value: 'Пример' });
  expect(parsed.entries).toContainEqual({ key: 'future-feature', value: 'keep this' });
  expect(parsed.header).not.toContain(body);
  expect(Object.isFrozen(parsed.resources[0])).toBe(true);
});

test('distinguishes absent grants from explicit none and preserves scheduling modes', () => {
  expect(parseUserScript(script()).grantNone).toBe(false);
  expect(parseUserScript(script()).grants).toEqual([]);
  expect(parseUserScript(script()).runAt).toBe('document-idle');
  expect(parseUserScript(script('// @grant none')).grantNone).toBe(true);
  for (const mode of ['document-start', 'document-body', 'document-end', 'document-idle', 'context-menu'] as const)
    expect(parseUserScript(script(`// @run-at ${mode}`)).runAt).toBe(mode);
});

test('accepts BOM, licenses and CRLF; metadata-like text in body is inert', () => {
  const source = '\ufeff /* License */\r\n// introductory comment\r\n' + script('// @grant none', 'const fake = `// @grant GM_setValue`;').replaceAll('\n', '\r\n');
  expect(parseUserScript(source).grants).toEqual([]);
  expect(parseUserScript(source).grantNone).toBe(true);
  expect(() => parseUserScript('const fake = `' + script() + '`')).toThrow(ScriptImportError);
  expect(() => parseUserScript('/* ' + script() + ' */')).toThrow(ScriptImportError);
  expect(() => parseUserScript('// comment\u2028alert(1);\n' + script())).toThrow(ScriptImportError);
});

test('rejects incomplete and ambiguous permission or lifecycle metadata', () => {
  for (const source of [
    '// ==UserScript==\n// @name Example',
    '// ==UserScript==\n// @name Example\nalert(1);\n// ==/UserScript==',
    script('// @grant none\n// @grant GM_setValue'),
    script('// @run-at typo'), script('// @run-at document-start\n// @run-at document-end'),
    script('// @name Another'), script('// @match'), script('// @grant'),
    script('// @resource theme\n'), script('// @resource theme https://a/\n// @resource theme https://b/'),
    script('// ==UserScript=='), ' '.repeat(2 * 1024 * 1024 + 1),
  ]) expect(() => parseUserScript(source)).toThrow(ScriptImportError);
});
