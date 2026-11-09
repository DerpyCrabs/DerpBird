import { test, expect } from 'bun:test';
import { Window, type HTMLButtonElement, type HTMLElement } from 'happy-dom';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function downloadPage(): string {
  // Frontend tests also run before prepare:engine on a fresh checkout.
  const repo = resolve(import.meta.dir, '..');
  const path = 'Base/res/ladybird/about-pages/downloads.html';
  const directory = mkdtempSync(join(tmpdir(), 'derpbird-download-page-'));
  try {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, execFileSync('git', ['-C', join(repo, 'vendor/ladybird'), 'show', `HEAD:${path}`]));
    for (const patch of ['0070-persist-terminal-download-history.patch', '0071-page-download-history-rendering.patch'])
      execFileSync('git', ['apply', `--include=${path}`, join(repo, 'patches', patch)], { cwd: directory });
    return readFileSync(file, 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('download history bounds rendered rows, pages and coalesces updates', async () => {
  const window = new Window({ url: 'https://browser.test/' });
  const html = downloadPage();
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1];
  const frames: (() => void)[] = [];
  Object.assign(window, { ladybird: { sendMessage() {} }, requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; } });
  window.document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module">'));
  window.eval(script);
  const send = (name: string, data: unknown) => window.document.dispatchEvent(new window.CustomEvent('WebUIMessage', { detail: { name, data } }));
  const entry = (id: number) => ({ id, fileName: `file-${id}`, url: 'https://example.com/', destination: `/tmp/file-${id}`, status: 'completed', downloadedSize: 10, totalSize: 10 });
  send('loadDownloads', Array.from({length: 5000}, (_, i) => entry(i + 1)));
  const rows = () => window.document.querySelectorAll('.download-entry');
  expect(rows()).toHaveLength(50);
  expect(rows()[0].textContent).toContain('file-5000');
  expect(window.document.querySelector('#downloads-page')!.textContent).toBe('Page 1 of 100');
  window.document.querySelector<HTMLButtonElement>('#downloads-next')!.click();
  expect(rows()).toHaveLength(50);
  expect(rows()[0].textContent).toContain('file-4950');
  for (let i = 0; i < 100; i++) send('downloadUpdated', { ...entry(4950), status: 'in-progress', downloadedSize: i });
  expect(frames).toHaveLength(1);
  frames.shift()!();
  expect(rows()).toHaveLength(50);
  send('downloadAdded', entry(5001));
  frames.shift()!();
  expect(rows()[0].textContent).toContain('file-5001');
  send('loadDownloads', [entry(1)]);
  expect(rows()).toHaveLength(1);
  expect(window.document.querySelector<HTMLElement>('#download-pages')!.hidden).toBe(true);
  expect(rows()[0].querySelector('progress')!.hidden).toBe(true);
  await window.happyDOM.close();
});
