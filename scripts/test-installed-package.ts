import { useTestProfile } from './agent-test-profile';
await useTestProfile();
/** Exercise the installed standalone MCP, from outside the source tree. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir } from 'node:fs/promises';
const output = `${process.cwd()}/artifacts/package-check`;
await mkdir(output, { recursive: true });
const fixture = Bun.serve({ port: 0, fetch: () => new Response('<title>Installed package</title><h1>Installed DerpBird</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'input\').value">Apply</button>', { headers: { 'Content-Type': 'text/html' } }) });
const client = new Client({ name: 'installed-package-check', version: '1.0' });
const transport = new StdioClientTransport({ command: '/usr/bin/derpbird-mcp', cwd: '/tmp', env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), stderr: 'inherit' });
const results: any[] = [];
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  results.push({ name, result });
  return JSON.stringify(result.content);
}
try {
  await client.connect(transport);
  await call('derpbird_session', { action: 'launch' });
  assert.match(await call('browser_navigate', { url: fixture.url.href }), /Installed DerpBird/);
  const deadline = Date.now() + 15000;
  while (!(await call('browser_evaluate', { function: '() => innerWidth > 300 && innerHeight > 200' })).includes('true')) {
    assert(Date.now() < deadline, 'Shell viewport did not finish initial layout');
    await Bun.sleep(50);
  }
  await call('browser_type', { target: 'input', text: 'Package works' });
  await call('browser_click', { target: 'button' });
  assert.match(await call('browser_snapshot'), /Package works/);
  await call('derpbird_userstyle', { action: 'save', source: '/* ==UserStyle==\n@name Package style\n@namespace test\n@version 1.0.0\n@preprocessor less\n==/UserStyle== */\n@color: rgb(12, 34, 56); body { background: @color; }' });
  assert.match(await call('browser_evaluate', { function: '() => getComputedStyle(document.body).backgroundColor' }), /12, 34, 56/);
  await call('browser_scroll', { deltaY: 40 });
  assert.match(await call('browser_network_requests', { limit: 2 }), /nextOffset/);
  await call('browser_take_screenshot', { fullPage: true, filename: `${output}/page.png` });
  await call('derpbird_take_window_screenshot', { filename: `${output}/window.png` });
  console.log('Installed MCP: launch, navigation, trusted input, Less UserCSS and captures passed');
} finally {
  await call('derpbird_session', { action: 'close' }).catch(() => {});
  await client.close(); fixture.stop();
  await Bun.write(`${output}/report.json`, JSON.stringify(results, null, 2));
}
