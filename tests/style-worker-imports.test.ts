import { expect, test } from 'bun:test';
import { createStyleCompiler } from '../src/browser/style-compiler';

const base = 'https://derpbird-source.invalid/' + 'a'.repeat(64) + '/theme.user.css';
const header = (preprocessor: string) => `/* ==UserStyle==\n@name Directory\n@namespace test\n@version 1.0.0\n@preprocessor ${preprocessor}\n==/UserStyle== */\n`;

test('worker requests only used directory dependencies, including Stylus index imports', async () => {
  let network = 0;
  const compiler = createStyleCompiler(async () => { network++; throw new Error('Unexpected network access'); });
  const less = new URL('palette.less', base).href;
  const stylus = new URL('palette/index.styl', base).href;
  const unused = new URL('unused.less', base).href;
  const imports = {
    [less]: { url: less, source: '@accent: red;' },
    [stylus]: { url: stylus, source: 'accent = blue' },
    [unused]: { url: unused, source: '/*' + 'x'.repeat(1024 * 1024) + '*/' },
  };
  try {
    const first = await compiler.compile(header('less') + '@import "palette.less"; body {color: @accent}', {}, { sourceURL: base, imports });
    expect(first.sections[0].css).toContain('red');
    expect(Object.keys(first.imports ?? {})).toEqual([less]);
    const second = await compiler.compile(header('stylus') + '@import "palette"\nbody\n  color accent', {}, { sourceURL: base, imports });
    expect(second.sections[0].css).toContain('#00f');
    expect(Object.keys(second.imports ?? {})).toEqual([stylus]);
    await expect(compiler.compile(header('less') + '@import "missing.less";', {}, { sourceURL: base, imports })).rejects.toThrow('Локальная зависимость отсутствует');
    expect(network).toBe(0);
    const changed = await compiler.compile(header('less') + '@import "palette.less"; body {color: @accent}', {}, {
      sourceURL: base, imports: { [less]: { url: less, source: '@accent: green;' } },
    });
    expect(changed.sections[0].css).toContain('green');
  } finally { compiler.close(); }
});
