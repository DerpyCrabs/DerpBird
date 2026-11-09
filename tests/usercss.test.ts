import { test, expect } from 'bun:test';
import { compileStyle } from '../src/browser/style-compile';
import { readUserCSS, userCSSValues } from '../src/browser/usercss-metadata';
import { createStyleCompiler } from '../src/browser/style-compiler';
import { decodeStyleSnapshot } from '../src/browser/style-protocol';

const header = (preprocessor: string, variables = '') => `/* ==UserStyle==
@name Fixture
@namespace derpbird.test
@version 1.0.0
@preprocessor ${preprocessor}
${variables}
==/UserStyle== */`;

test('UserCSS variables preserve scope, choices, numeric units and persisted values', async () => {
  const source = header('default', '@var color accent "Accent" #112233\n@var range size "Size" [12, 8, 24, 2, "px"]\n@var select font "Font" {"sans*":"sans-serif","serif":"serif"}\n@var checkbox dense "Dense" 1') + '\n@-moz-document domain("example.com") {body{color:var(--accent);font-size:var(--size)}}';
  const compiled = await compileStyle(source, { accent: '#abcdef', size: 16, font: 'serif', dense: 0 });
  expect(compiled.sections).toHaveLength(1);
  expect(compiled.sections[0].conditions).toEqual([{ type: 'domain', value: 'example.com' }]);
  expect(compiled.sections[0].css).toContain('--accent:#abcdef');
  expect(compiled.sections[0].css).toContain('--size:16px');
  expect(compiled.sections[0].css).toContain('--font:serif');
  expect(compiled.sections[0].css).toContain('--dense:0');
  const snapshot = decodeStyleSnapshot({ revision: 1, items: [{id:'one',name:'Fixture',source,enabled:true,sections:compiled.sections,usercss:{values:compiled.values}}] });
  expect(snapshot.items[0].usercss?.values).toEqual(compiled.values);
  expect(() => userCSSValues(readUserCSS(source)!, {size: 13})).toThrow();
  expect(() => userCSSValues(readUserCSS(source)!, {font: 'missing'})).toThrow();
});

test('Less and Stylus execute language constructs rather than text substitution', async () => {
  const less = await compileStyle(header('less','@var color accent "Accent" #123456\n@var number scale "Scale" [2,1,4,1]') + '\n@-moz-document domain("example.com") { .box {color:@accent; width:(@scale * 8px); &:hover {opacity:0.5} } }', {scale:3});
  expect(less.sections[0].conditions[0].value).toBe('example.com');
  expect(less.sections[0].css).toContain('24px');
  expect(less.sections[0].css).toContain('.box:hover');
  const stylus = await compileStyle(header('stylus','@var color accent "Accent" #123456\n@var number scale "Scale" [2,1,4,1]') + '\n@-moz-document domain("example.com")\n  .box\n    color accent\n    width scale * 8px\n    &:hover\n      opacity .5', {scale:3});
  expect(stylus.sections[0].conditions[0].value).toBe('example.com');
  expect(stylus.sections[0].css).toContain('24px');
  expect(stylus.sections[0].css).toContain('.box:hover');
});

test('USO expands RGB, alpha, selected snippets and detects substitution cycles', async () => {
  const source = header('uso','@var color accent "Accent" #112233\n@var select layout "Layout" {"normal*":"padding: 4px; color: /*[[accent]]*/"}') + '\nbody { /*[[layout]]*/; background:rgba(/*[[accent-rgb]]*/, .5); border-color:/*[[accent]]*/88; }';
  const result = await compileStyle(source);
  expect(result.sections[0].css).toContain('17, 34, 51');
  expect(result.sections[0].css).toContain('#11223388');
  expect(result.sections[0].css).toContain('padding: 4px');
  await expect(compileStyle(header('uso','@var select a "A" {"cycle":"/*[[a]]*/"}') + '\nbody{/*[[a]]*/}')).rejects.toThrow('Циклическая');
});

test('compilation cannot execute Less JavaScript or fetch compiler plugins/imports', async () => {
  await expect(compileStyle(header('less')+'\nbody{width:`globalThis.compromised=1`;}')).rejects.toBeDefined();
  await expect(compileStyle(header('less')+'\n@plugin "https://example.com/plugin.js";body{color:red}')).rejects.toBeDefined();
  await expect(compileStyle(header('less')+'\n@import "https://example.com/remote.less";')).rejects.toBeDefined();
  expect((globalThis as Record<string,unknown>).compromised).toBeUndefined();
});

test('worker compilation is cancellable and does not block a normal browser turn', async () => {
  const compiler = createStyleCompiler();
  try {
    const result = await compiler.compile(header('less')+'\n@a:3px;body{padding:(@a*2)}');
    expect(result.sections[0].css).toContain('6px');
    const pending = compiler.compile('body{color:red}');
    compiler.close();
    await expect(pending).rejects.toThrow('отменена');
    await expect(compiler.compile('body{}')).rejects.toThrow('закрыт');
  } finally { compiler.close(); }
});

test('Less imports use redirected base URLs and persist for offline variable changes', async () => {
  const calls: string[] = [];
  const source = header('less', '@var color accent "Accent" #123456') + '\n@import "./lib.less";\n@-moz-document domain("example.com") {body {.paint();}}';
  const compiled = await compileStyle(source, {}, { sourceURL: 'https://styles.example/main.user.less' }, async url => {
    calls.push(url);
    return url.endsWith('/lib.less')
      ? { url: 'https://cdn.example/theme/lib.less', source: '@import "./palette.less"; .paint(){color:@accent;background:@surface}' }
      : { url, source: '@surface: #abcdef;' };
  });
  expect(calls).toEqual(['https://styles.example/lib.less', 'https://cdn.example/theme/palette.less']);
  expect(compiled.sections[0].css).toContain('#abcdef');
  const offline = await compileStyle(source, { accent: '#ffffff' }, { sourceURL: 'https://styles.example/main.user.less', imports: compiled.imports });
  expect(offline.sections[0].css).toContain('#ffffff');
  expect(offline.imports).toEqual(compiled.imports);
});

test('Less import loader cannot read local files or use authenticated URLs', async () => {
  for (const url of ['file:///etc/passwd', 'https://user:secret@example.com/lib.less']) {
    let loaded = false;
    await expect(compileStyle(header('less') + `\n@import "${url}";`, {}, {}, async address => { loaded = true; return { url: address, source: '' }; })).rejects.toThrow();
    expect(loaded).toBe(false);
  }
});

test('compiler worker brokers imports through the supplied native source loader', async () => {
  const requests: string[] = [];
  const compiler = createStyleCompiler(async url => { requests.push(url); return { url, source: '.paint() { color: #123456; }' }; });
  try {
    const source = header('less') + '\n@import "./library.less";\n@-moz-document domain("example.com") {body{.paint()}}';
    const result = await compiler.compile(source, {}, { sourceURL: 'https://styles.example/style.user.less' });
    expect(requests).toEqual(['https://styles.example/library.less']);
    expect(result.sections[0].css).toContain('#123456');
    expect(result.imports?.[requests[0]].source).toContain('.paint');
  } finally { compiler.close(); }
});

test('a missing local import cannot escape the selected directory snapshot through network fallback', async () => {
  let fetched = false;
  const source = header('less') + '\n@import "../../outside.less";';
  await expect(compileStyle(source, {}, { sourceURL: 'https://derpbird-source.invalid/root/nested/theme.user.less', imports: {} }, async url => {
    fetched = true; return { url, source: 'body{color:red}' };
  })).rejects.toThrow('Локальная зависимость отсутствует');
  expect(fetched).toBe(false);
});

test('Stylus directory imports evaluate dynamic paths, nested scope and require-once', async () => {
  const root = 'https://derpbird-source.invalid/root/';
  const source = header('stylus') + '\nname = "palette"\n@import name\n@require "shared"\n@require "shared"\nbody\n  color accent\n  .nested\n    @import "nested/rules"';
  const files = {
    [root + 'palette.styl']: { url: root + 'palette.styl', source: 'accent = #123456' },
    [root + 'shared/index.styl']: { url: root + 'shared/index.styl', source: '.once\n  padding 7px' },
    [root + 'nested/rules.styl']: { url: root + 'nested/rules.styl', source: '@import "../size"\n.paint\n  width size' },
    [root + 'size.styl']: { url: root + 'size.styl', source: 'size = 19px' },
  };
  const result = await compileStyle(source, {}, { sourceURL: root + 'theme.user.styl', imports: files });
  const css = result.sections.map(section => section.css).join('\n');
  expect(css).toContain('#123456');
  expect(css).toContain('body .nested .paint');
  expect(css).toContain('19px');
  expect(css.match(/\.once/g)).toHaveLength(1);
  expect(Object.keys(result.imports!)).toHaveLength(4);
  const offline = await compileStyle(source, {}, { sourceURL: root + 'theme.user.styl', imports: result.imports });
  expect(offline.sections).toEqual(result.sections);
});

test('Stylus imports follow dependency redirects and persist offline', async () => {
  const calls: string[] = [];
  const source = header('stylus') + '\n@import "library"\nbody\n  color accent';
  const result = await compileStyle(source, {}, { sourceURL: 'https://styles.example/main.user.styl' }, async url => {
    calls.push(url);
    return url.endsWith('/library.styl')
      ? { url: 'https://cdn.example/theme/library.styl', source: '@import "palette"' }
      : { url, source: 'accent = #123456' };
  });
  expect(calls).toEqual(['https://styles.example/library.styl', 'https://cdn.example/theme/palette.styl']);
  expect(result.sections[0].css).toContain('#123456');
  expect((await compileStyle(source, {}, { sourceURL: 'https://styles.example/main.user.styl', imports: result.imports })).sections).toEqual(result.sections);
});

test('Stylus directory imports reject cycles and missing paths without network fallback', async () => {
  const root = 'https://derpbird-source.invalid/root/';
  const source = header('stylus') + '\n@import "library"';
  let fetched = false;
  await expect(compileStyle(source, {}, { sourceURL: root + 'theme.user.styl' }, async url => {
    fetched = true; return { url, source: '' };
  })).rejects.toThrow('Локальная зависимость отсутствует');
  expect(fetched).toBe(false);
  await expect(compileStyle(source, {}, { sourceURL: root + 'theme.user.styl', imports: {
    [root + 'library.styl']: { url: root + 'library.styl', source: '@import "library"' },
  } })).rejects.toThrow('Циклический импорт');
});

test('cancelling worker compilation aborts its pending import and permits another compilation', async () => {
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let aborted = false;
  const compiler = createStyleCompiler((_url, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true });
    began();
  }));
  try {
    const pending = compiler.compile(header('less') + '\n@import "./slow.less";', {}, { sourceURL: 'https://example.org/theme.less' });
    await started; compiler.cancel();
    await expect(pending).rejects.toThrow('отменена');
    expect(aborted).toBe(true);
    const next = await compiler.compile('body { color: red; }');
    expect(next.sections[0].css).toContain('red');
  } finally { compiler.close(); }
});

test('default UserCSS variables stay outside assembled selector and keyframe ancestors', async () => {
  const result = await compileStyle(`${header('default', '@var color accent "Accent" #123456')}
    @layer { body { @-moz-document domain("example.com") { color:var(--accent) } } }`);
  const structural = result.sections.filter(section => section.wrappers !== undefined);
  const variables = result.sections.filter(section => section.wrappers === undefined);
  expect(structural.length).toBeGreaterThan(0);
  expect(structural.every(section => !section.css.includes(':root'))).toBe(true);
  expect(variables).toHaveLength(1);
  expect(variables[0].conditions).toEqual([{ type: 'domain', value: 'example.com' }]);
  expect(variables[0].css).toContain('--accent:');
  expect(decodeStyleSnapshot({ revision: 1, items: [{ id: 'style', name: 'Style', enabled: true, source: '', sections: result.sections }] }).items[0].sections).toEqual(result.sections);
});
