import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

export function studyDocument(root: string): Plugin {
  return {
    name: 'unified-settings-study',
    configureServer(server) {
      // Ladybird loads the same single-file worker format as the packaged browser.
      server.middlewares.use('/settings-study/compiler.js', async (_req, res, next) => {
        try {
          const result = await build({
            configFile: false,
            root,
            logLevel: 'error',
            build: {
              write: false,
              target: 'es2023',
              lib: {
                entry: resolve(root, 'src/browser/style-compiler.worker.ts'),
                name: 'StyleWorker',
                formats: ['iife'],
              },
              rollupOptions: { output: { codeSplitting: false, keepNames: true } },
            },
          });
          const bundle = Array.isArray(result) ? result[0] : result;
          if (!('output' in bundle)) throw Error('Missing style compiler output');
          const worker = bundle.output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
          if (worker?.type !== 'chunk') throw Error('Missing style compiler entry');
          res.setHeader('Content-Type', 'application/javascript');
          res.end(worker.code);
        } catch (error) {
          next(error);
        }
      });
      server.middlewares.use('/settings-study/preferences.html', async (_req, res, next) => {
        try {
          const resources = resolve(root, 'vendor/ladybird/Base/res');
          const native = await readFile(resolve(resources, 'ladybird/about-pages/settings.html'), 'utf8');
          const html = native
            .replace(
              'resource://ladybird/about-pages/derpbird-assets/settings-layout.js',
              '/@fs/' + resolve(root, 'src/settings-layout.tsx'),
            )
            .replaceAll('resource://', '/@fs/' + resources + '/')
            .replace('</head>', '<script type="module" src="/settings-study/native-fixture.ts"></script></head>');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
