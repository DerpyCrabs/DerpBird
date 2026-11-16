import { useTestProfile } from './agent-test-profile';
await useTestProfile();
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { symlink, unlink } from 'node:fs/promises';
import { AgentSessions } from '../src/automation/sessions';
import { manageSource } from '../src/automation/sources';
import { NativeConnection } from '../src/automation/connection';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const sessions = new AgentSessions();
const attached = new AgentSessions();
const fixture = process.env.AGENT_FIXTURE!;
const out = process.env.AGENT_OUTPUT!;
let client: Client | undefined;
const reference = (snapshot: string, role: string, name: string) => {
  const line = snapshot.split('\n').find(line => line.includes(`${role} ${JSON.stringify(name)} `));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  assert(ref, `Missing ${role} ${name}: ${snapshot}`); return ref;
};
try {
  const launched = await sessions.launch();
  const first = launched.find(session => session.selected)!;
  const advertisedSocket = join(process.env.XDG_RUNTIME_DIR!, `derpbird-automation-${process.pid}.sock`);
  await symlink(first.socket, advertisedSocket);
  try { assert((await sessions.discover()).some(browser => browser.socket === advertisedSocket && browser.windows.length === 1)); }
  finally { await unlink(advertisedSocket); }
  console.log('Launched agent window', first.id);
  console.log('Windows', JSON.stringify(await sessions.browser.windows()));
  console.log('Contexts', JSON.stringify(await sessions.browser.connection.request('browsingContext.getTree')));
  let snapshot = await sessions.browser.navigate(fixture);
  assert.match(snapshot, /Agent fixture/);
  await sessions.browser.navigate(new URL('/frame?name=Back', fixture).href);
  snapshot = await sessions.browser.back();
  assert.match(snapshot, /heading "Agent fixture"/);
  await sessions.browser.evaluate('() => { history.pushState({}, "", "#one"); history.pushState({}, "", "#two"); }');
  snapshot = await sessions.browser.back();
  assert.equal(await sessions.browser.evaluate('() => location.hash'), '#one');
  await sessions.browser.evaluate('() => { history.pushState({first: true}, "", location.href); history.pushState({second: true}, "", location.href); }');
  snapshot = await sessions.browser.back();
  assert.deepEqual(await sessions.browser.evaluate('() => history.state'), { first: true });
  console.log(snapshot);
  snapshot = await sessions.browser.type(reference(snapshot, 'textbox', 'Name'), 'Ada');
  snapshot = await sessions.browser.click(reference(snapshot, 'button', 'Apply'));
  assert.equal(await sessions.browser.evaluate('() => window.trusted'), true, 'Click must use real input');
  assert.equal(await sessions.browser.evaluate('() => document.querySelector("output").textContent'), 'Ada');
  await Bun.write(join(out, 'page.png'), Buffer.from((await sessions.browser.screenshot()).data, 'base64'));
  console.log('Native input and screenshot passed');
  assert(sessions.browser.consoleMessages().some(message => message.text?.includes('applied')));
  await sessions.browser.evaluate('() => new Promise(resolve => setTimeout(resolve, 100))');
  assert(sessions.browser.networkRequests({url:'/data'}).events.some(event => event.url?.endsWith('/data')));
  await sessions.browser.evaluate(`() => { document.querySelector('#probe').onpointerover = e => window.hoverTrusted = e.isTrusted; document.querySelector('#drop').onpointerup = e => window.dropTrusted = e.isTrusted; }`);
  await sessions.browser.pressKey('Tab');
  // Move away first: the previous click already left the pointer over Apply.
  snapshot = await sessions.browser.hover(reference(snapshot, 'textbox', 'Name'));
  snapshot = await sessions.browser.hover(reference(snapshot, 'button', 'Apply'));
  assert.equal(await sessions.browser.evaluate('() => window.hoverTrusted'), true);
  const selectLine = snapshot.split('\n').find(line => line.includes('"Color"') && line.includes('[ref='));
  assert(selectLine, snapshot);
  snapshot = await sessions.browser.selectOption(selectLine.match(/\[ref=(e\d+)\]/)![1], ['blue']);
  assert.equal(await sessions.browser.evaluate('() => document.querySelector("#color").value'), 'blue');
  const dragRef = snapshot.match(/generic \[ref=(e\d+)\]\n\s+- text leaf "Drag me"/)?.[1];
  const dropRef = snapshot.match(/generic \[ref=(e\d+)\]\n\s+- text leaf "Drop here"/)?.[1];
  assert(dragRef && dropRef, snapshot);
  snapshot = await sessions.browser.drag(dragRef, dropRef);
  assert.equal(await sessions.browser.evaluate('() => window.dropTrusted'), true);
  const inspected = await sessions.browser.inspect(reference(snapshot, 'button', 'Apply'), ['color']);
  assert(inspected.html.includes('id="probe"') && inspected.rect.width > 0 && inspected.styles.color);
  console.log('Hover, drag, select, DOM/style inspection, console and network passed');
  for (const name of ['Same', 'Cross']) {
    snapshot = await sessions.browser.type(reference(snapshot, 'textbox', `Frame ${name}`), name);
    snapshot = await sessions.browser.click(reference(snapshot, 'button', `Apply ${name}`));
    assert.equal(await sessions.browser.evaluate('el => el.ownerDocument.defaultView.clicked', reference(snapshot, 'button', `Apply ${name}`)), true);
    assert.equal(await sessions.browser.evaluate('el => el.ownerDocument.querySelector("output").textContent', reference(snapshot, 'button', `Apply ${name}`)), name);
  }
  console.log('Same-origin and cross-origin frame snapshots and native input passed');
  await assert.rejects(sessions.browser.evaluate('() => { window.promptAnswer = prompt("Agent prompt", "default"); return window.promptAnswer; }'), /browser_handle_dialog/);
  assert.match(await sessions.browser.snapshot(), /Agent prompt/);
  await sessions.browser.handleDialog(true, 'answered');
  assert.equal(await sessions.browser.evaluate('() => window.promptAnswer'), 'answered');
  await assert.rejects(sessions.browser.evaluate('() => { window.confirmAnswer = confirm("Agent confirm"); }'), /browser_handle_dialog/);
  await sessions.browser.handleDialog(false);
  assert.equal(await sessions.browser.evaluate('() => window.confirmAnswer'), false);
  await sessions.browser.evaluate('() => { document.querySelector("#probe").onclick = () => alert("Click alert"); }');
  snapshot = await sessions.browser.snapshot();
  await assert.rejects(sessions.browser.click(reference(snapshot, 'button', 'Apply')), /browser_handle_dialog/);
  await sessions.browser.handleDialog(true);
  snapshot = await sessions.browser.snapshot();
  console.log('Prompt, confirm and click-triggered alert resumed correctly');
  await assert.rejects(sessions.browser.evaluate('() => { alert("First"); alert("Second"); window.dialogSequenceDone = true; }'), /browser_handle_dialog/);
  await assert.rejects(sessions.browser.handleDialog(true), /browser_handle_dialog/);
  await sessions.browser.handleDialog(true);
  assert.equal(await sessions.browser.evaluate('() => window.dialogSequenceDone'), true);
  await sessions.browser.evaluate('() => { document.querySelector("#upload").onchange = e => window.uploadTrusted = e.isTrusted; }');
  snapshot = await sessions.browser.click(await sessions.browser.resolveTarget('#upload'));
  const pickerDeadline = Date.now() + 3000;
  while (!snapshot.includes('File chooser open') && Date.now() < pickerDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    snapshot = await sessions.browser.snapshot();
  }
  assert.match(snapshot, /File chooser open/);
  await assert.rejects(sessions.browser.upload(['/does-not-exist']), /regular files/);
  const uploadPath = join(out, 'upload.txt');
  await Bun.write(uploadPath, 'Native upload fixture');
  snapshot = await sessions.browser.upload([uploadPath]);
  assert.equal(await sessions.browser.evaluate('() => window.uploadTrusted'), true);
  assert.equal(await sessions.browser.evaluate('() => document.querySelector("#upload").files[0].text()'), 'Native upload fixture');
  await sessions.browser.click(await sessions.browser.resolveTarget('#upload'));
  snapshot = await sessions.browser.upload();
  assert.equal(await sessions.browser.evaluate('() => document.querySelector("#upload").files[0].name'), 'upload.txt');
  console.log('Native file chooser upload, validation and cancellation passed');
  const oldRef = reference(snapshot, 'button', 'Apply');
  await sessions.browser.reload();
  await assert.rejects(sessions.browser.click(oldRef), /Stale|unknown|no such node/i);

  await attached.attach(first.socket);
  await attached.browser.target();
  assert.equal(await attached.browser.evaluate('() => document.title'), 'Agent browser fixture');
  await attached.close();
  assert.equal(await sessions.browser.evaluate('() => document.title'), 'Agent browser fixture');
  console.log('Attached client disconnect preserved the browser');

  client = new Client({ name: 'derpbird-integration-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'bun', args: ['src/automation/server.ts', '--socket', first.socket], cwd: process.cwd(), stderr: 'pipe' }));
  const tools = await client.listTools();
  assert(tools.tools.some(tool => tool.name === 'browser_snapshot'));
  const shell = await client.callTool({ name: 'derpbird_shell', arguments: {} });
  assert.equal(shell.isError, undefined);
  assert.equal(JSON.parse((shell.content as any)[0].text).automation.enabled, true);
  const mcpResult = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => Promise.resolve(42)' } });
  assert.equal(mcpResult.isError, undefined);
  assert.deepEqual(mcpResult.content, [{ type: 'text', text: '42' }]);
  const cssTarget = await client.callTool({ name: 'browser_evaluate', arguments: { target: '#probe', function: '(el) => el.textContent' } });
  assert.deepEqual(cssTarget.content, [{ type: 'text', text: 'Apply' }]);
  const scoped = await client.callTool({ name: 'browser_snapshot', arguments: { target: '#probe', depth: 1 } });
  assert.equal(scoped.isError, undefined);
  assert.match((scoped.content as any)[0].text, /button "Apply"/);
  const noMatch = await client.callTool({ name: 'browser_hover', arguments: { target: '.missing' } });
  assert.equal(noMatch.isError, true);
  const wait = await client.callTool({ name: 'browser_wait_for', arguments: { text: 'Agent fixture', time: 0 } });
  assert.equal(wait.isError, undefined);
  const ordered = await Promise.all([
    client.callTool({ name: 'browser_evaluate', arguments: { function: 'async () => { await new Promise(resolve => setTimeout(resolve, 80)); window.ordered = 1; }' } }),
    client.callTool({ name: 'browser_evaluate', arguments: { function: '() => window.ordered' } }),
  ]);
  assert.deepEqual(ordered[1].content, [{ type: 'text', text: '1' }]);
  const resized = await client.callTool({ name: 'browser_resize', arguments: { width: 900, height: 600 } });
  assert.equal(resized.isError, undefined, JSON.stringify(resized));
  assert.deepEqual(await sessions.browser.evaluate('() => [outerWidth, outerHeight]'), [900, 600]);
  await sessions.browser.evaluate('() => { document.body.style.minHeight = "1500px"; }');
  const fullImage = Buffer.from((await sessions.browser.screenshot(true)).data, 'base64');
  assert(fullImage.readUInt32BE(20) >= 1500);
  const elementImage = Buffer.from((await sessions.browser.screenshot(false, await sessions.browser.resolveTarget('#probe'))).data, 'base64');
  assert(elementImage.readUInt32BE(16) < 200);
  await client.callTool({ name: 'browser_resize', arguments: { width: 1280, height: 900 } });
  const workspacesBefore = JSON.parse((shell.content as any)[0].text).workspaces;
  const workspace = await client.callTool({ name: 'derpbird_shell', arguments: { command: { type: 'workspace.create', name: 'Agent test', icon: 'code', color: 'blue' } } });
  assert.equal(workspace.isError, undefined, JSON.stringify(workspace));
  const workspaceState = JSON.parse((workspace.content as any)[0].text);
  assert(workspaceState.workspaces.items.some((item: any) => item.name === 'Agent test'));
  const restored = await client.callTool({ name: 'derpbird_shell', arguments: { command: { type: 'workspace.switch', id: workspacesBefore.active } } });
  assert.equal(restored.isError, undefined);
  await client.close(); client = undefined;
  console.log('MCP SDK client handshake and tool call passed');

  const style = await manageSource(sessions.browser, 'styles', { action: 'save', source: `@-moz-document url-prefix("${fixture}") { #probe { color: rgb(1, 2, 3) !important; } }`, name: 'Agent test style' });
  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => getComputedStyle(document.querySelector("#probe")).color'), 'rgb(1, 2, 3)');
  const script = await manageSource(sessions.browser, 'scripts', { action: 'save', source: `// ==UserScript==\n// @name Agent fixture\n// @namespace derpbird-test\n// @match http://127.0.0.1/*\n// @run-at document-end\n// @noframes\n// @grant GM_getValue\n// @grant GM_setValue\n// @grant GM_registerMenuCommand\n// ==/UserScript==\nGM_registerMenuCommand("Agent menu",()=>document.body.dataset.menu="yes");const n=GM_getValue('n',0)+1;GM_setValue('n',n);document.body.dataset.agentCount=String(n);` });
  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.agentCount'), '1');
  const commandState = await sessions.browser.currentShell({ type: 'snapshot' });
  const menu = commandState.scriptCommands.find((command: any) => command.label === 'Agent menu');
  assert(menu, 'GM menu command must be exposed in shell state');
  client = new Client({ name: 'derpbird-menu-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'bun', args: ['src/automation/server.ts', '--socket', first.socket], cwd: process.cwd(), stderr: 'pipe' }));
  const invoked = await client.callTool({ name: 'derpbird_shell', arguments: { command: { type: 'script.command', tabId: commandState.activeTabId, id: menu.id } } });
  assert.equal(invoked.isError, undefined, JSON.stringify(invoked));
  await client.close(); client = undefined;
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.menu'), 'yes');

  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.agentCount'), '2');
  await manageSource(sessions.browser, 'scripts', { action: 'disable', id: script.id });
  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.agentCount'), undefined);
  await manageSource(sessions.browser, 'scripts', { action: 'enable', id: script.id });
  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.agentCount'), '3');
  await assert.rejects(manageSource(sessions.browser, 'scripts', { action: 'remove', id: script.id, revision: 0 }), /Sources changed/);
  await manageSource(sessions.browser, 'styles', { action: 'disable', id: style.id });
  await sessions.browser.reload();
  assert.notEqual(await sessions.browser.evaluate('() => getComputedStyle(document.querySelector("#probe")).color'), 'rgb(1, 2, 3)');
  await manageSource(sessions.browser, 'scripts', { action: 'remove', id: script.id });
  await manageSource(sessions.browser, 'styles', { action: 'remove', id: style.id });
  await sessions.browser.reload();
  assert.equal(await sessions.browser.evaluate('() => document.body.dataset.agentCount'), undefined);
  console.log('Real UserCSS matching and GM storage lifecycle passed');

  await sessions.browser.devtools('snapshot');
  await sessions.browser.reload();
  await sessions.browser.evaluate(`async () => { await fetch('/data'); console.log('inspector-capture'); }`);
  let inspector: any;
  const captureDeadline = Date.now() + 10000;
  for (;;) {
    inspector = await sessions.browser.devtools('snapshot');
    if (inspector.requests.some((request: any) => request.url.endsWith('/data') && request.complete) && inspector.sources.length) break;
    assert(Date.now() < captureDeadline, 'DevTools capture did not complete');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const captured = inspector.requests.find((request: any) => request.url.endsWith('/data'));
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(await sessions.browser.devtools('response', captured.id)), { ok: true });
  const source = await sessions.browser.devtools('source', inspector.sources[0].id);
  assert.equal(typeof source, 'string');
  assert(source.length > 0);
  assert(inspector.messages.some((entry: any) => entry.text.includes('inspector-capture')));
  console.log('Shared native DevTools response bodies, script sources and console passed');

  await sessions.browser.evaluate('() => { localStorage.agent="first"; }');
  await sessions.launch();
  await sessions.browser.navigate(fixture);
  assert.equal(await sessions.browser.evaluate('() => localStorage.agent'), 'first');
  await sessions.close();
  sessions.select(first.id);
  assert.equal(await sessions.browser.evaluate('() => localStorage.agent'), 'first');
  console.log('Two agent windows share the same profile');

  const originalContext = await sessions.browser.target();
  const originalTabCount = (await sessions.browser.tabs()).length;
  await sessions.browser.newTab();
  await sessions.browser.navigate(fixture);
  assert.notEqual(await sessions.browser.target(), originalContext);
  assert.equal((await sessions.browser.tabs()).length, originalTabCount + 1);
  const splitTabs = await sessions.browser.tabs();
  const firstSplitTab = splitTabs.find(tab => tab.context === originalContext)!;
  const secondSplitTab = splitTabs.find(tab => tab.context === sessions.browser.context)!;
  await sessions.browser.currentShell({ type: 'command', command: { type: 'tab.split', tabId: secondSplitTab.id, targetId: firstSplitTab.id, edge: 'right' } });
  const splitState = await sessions.browser.currentShell({ type: 'snapshot' });
  assert(splitState.splits.some((split: any) => [split.firstTabId, split.secondTabId].includes(firstSplitTab.id) && [split.firstTabId, split.secondTabId].includes(secondSplitTab.id)));
  await sessions.browser.currentShell({ type: 'command', command: { type: 'split.resize', tabId: firstSplitTab.id, ratio: 0.4 } });
  assert.equal((await sessions.browser.currentShell({ type: 'snapshot' })).splits[0].ratio, 0.4);
  await sessions.browser.closeTab();
  await sessions.browser.select((await sessions.browser.tabs()).findIndex(tab => tab.context === originalContext));
  const originalWindow = sessions.browser.windowId;
  await sessions.browser.currentShell({ type: 'command', command: { type: 'window.new', url: fixture, private: false } });
  const windowDeadline = Date.now() + 10000;
  while ((await sessions.browser.windows()).length < 2) {
    assert(Date.now() < windowDeadline, 'Second window did not open');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await attached.attach(first.socket);
  await assert.rejects(attached.browser.target(), /Several browser windows/);
  const other = (await attached.browser.tabs()).findIndex(tab => tab.windowId !== originalWindow);
  await attached.browser.select(other);
  await attached.browser.evaluate('() => { window.agentSelected = true; }');
  assert.equal(await sessions.browser.evaluate('() => window.agentSelected'), undefined);
  await attached.browser.closeTab(other);
  await attached.close();
  console.log('Tab lifecycle and explicit multi-window selection passed');

  const state = await sessions.browser.currentShell({ type: 'snapshot' });
  assert.equal(state.automation.enabled, true);
  const contexts = await sessions.browser.connection.request('browsingContext.getTree');
  const chrome = contexts.contexts.find((item: any) => item.url.startsWith('about:derpbird'));
  assert(chrome, 'Shell must be present for native UI verification');
  const shellResult = await sessions.browser.connection.request('script.evaluate', { target: { context: chrome.context }, expression: `document.querySelector('[aria-label="Disable AI browser access"]') === null && document.querySelector('[aria-label="Enable AI browser access"]') === null`, awaitPromise: false });
  assert.equal(shellResult.result.value, true, 'Local automation needs no opt-in controls');
  await attached.attach(first.socket);
  await attached.close();
  assert.equal((await sessions.browser.currentShell({ type: 'snapshot' })).automation.enabled, true);
  console.log('Local automation remains available after attached client disconnect');
} catch (error) {
  console.error(JSON.stringify(sessions.diagnostics(), null, 2));
  throw error;
} finally {
  await client?.close();
  await attached.closeAll();
  await sessions.closeAll();
}
