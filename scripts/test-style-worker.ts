import { Glob } from 'bun';
import { strict as assert } from 'node:assert';
import { stat } from 'node:fs/promises';
const files = await Array.fromAsync(new Glob('dist/assets/style-compiler.worker-*.js').scan('.'));
const bundle = (await Promise.all(files.map(async path => ({ path, size: (await stat(path)).size })))).find(file => file.size > 10000);
assert(bundle, 'Build the UI before testing its compiler worker');
const worker = new Worker(new URL('../' + bundle.path, import.meta.url));
const timer = setTimeout(() => { worker.terminate(); throw new Error('Bundled compiler timed out'); }, 5000);
try {
  for (const [preprocessor, source] of [
    ['less', '@-moz-document domain("example.com") {h1 {color:@accent; width:(3 * 8px)}}'],
    ['stylus', '@-moz-document domain("example.com")\n  h1\n    color accent\n    width 3 * 8px'],
  ]) {
    const response = await new Promise<any>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = reject;
      worker.postMessage({ source: `/* ==UserStyle==\n@name Bundle fixture\n@namespace test\n@version 1.0.0\n@preprocessor ${preprocessor}\n@var color accent "Accent" #123456\n==/UserStyle== */\n${source}`, values: {} });
    });
    assert(response.ok, response.error);
    assert.equal(response.value.sections[0].conditions[0].value, 'example.com');
    assert.match(response.value.sections[0].css, /24px/);
    assert.match(response.value.sections[0].css, /#123456/);
  }
  console.log('Production Less + Stylus worker: passed');
} finally { clearTimeout(timer); worker.terminate(); }
