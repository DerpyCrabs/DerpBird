import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { AgentSessions } from './sessions';
import { manageSource } from './sources';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined' }] });
const ref = z.string().describe('Exact target element reference from browser_snapshot');
const element = z.string().optional().describe('Human-readable element description');
const target = z.string().optional().describe('Element reference from browser_snapshot, or a unique CSS selector');
const targeting = { element, target, ref: ref.optional().describe('Legacy alias for target') };

export function createAgentServer(sessions: AgentSessions) {
  const server = new McpServer({ name: 'derpbird', version: '0.1.0' });
  // Tool calls share selected session/tab and snapshot references. Keep each operation atomic.
  let queue: Promise<unknown> = Promise.resolve();
  async function resolveTarget(args: { target?: string; ref?: string }, required = true) {
    const value = args.target ?? args.ref;
    if (!value) { if (required) throw new Error('target (or ref) is required'); return undefined; }
    return sessions.browser.resolveTarget(value);
  }
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<any>, readOnly = false) {
    server.registerTool(name, { description, inputSchema: z.object(shape), annotations: { readOnlyHint: readOnly, openWorldHint: true } }, async args => {
      const result = queue.then(() => run(args as z.infer<z.ZodObject<S>>));
      queue = result.catch(() => {});
      try { return await result; }
      catch (error) { return { ...text(error instanceof Error ? error.message : String(error)), isError: true }; }
    });
  }
  tool('derpbird_session', 'Manage browser connections. Launch creates a separate agent browser with an isolated profile. Attach connects to an explicitly enabled user browser. Closing an attached session only disconnects.', {
    action: z.enum(['list', 'discover', 'launch', 'attach', 'select', 'close']), socket: z.string().optional(), id: z.string().optional(),
  }, async args => {
    if (args.action === 'discover') return text(await sessions.discover());
    if (args.action === 'launch') return text(await sessions.launch());
    if (args.action === 'attach') { if (!args.socket) throw new Error('socket is required'); return text(await sessions.attach(args.socket)); }
    if (args.action === 'select') { if (!args.id) throw new Error('id is required'); return text(sessions.select(args.id)); }
    if (args.action === 'close') await sessions.close(args.id);
    return text(sessions.list());
  });
  tool('browser_tabs', 'List, create, close, or select a browser tab. Explicitly select a tab when several windows are available.', { action: z.enum(['list', 'new', 'close', 'select']), index: z.number().int().nonnegative().optional() }, async args => {
    if (args.action === 'list') return text((await sessions.browser.tabs()).map((tab, index) => ({ index, ...tab, selected: sessions.browser.context === tab.context })));
    if (args.action === 'new') return text(await sessions.browser.newTab());
    if (args.action === 'close') return text(await sessions.browser.closeTab(args.index));
    if (args.index === undefined) throw new Error('index is required');
    return text(await sessions.browser.select(args.index));
  });
  tool('browser_navigate', 'Navigate to a URL.', { url: z.string() }, async args => text(await sessions.browser.navigate(args.url)));
  tool('browser_navigate_back', 'Go back to the previous page.', {}, async () => text(await sessions.browser.back()));
  tool('browser_snapshot', 'Capture the engine accessibility tree with element references. Use these references for interactions.', { target, filename: z.string().optional(), depth: z.number().int().nonnegative().max(100).optional() }, async args => {
    const snapshot = await sessions.browser.snapshot(await resolveTarget(args, false), args.depth);
    if (args.filename) { await Bun.write(args.filename, snapshot); return text(`Saved ${args.filename}`); }
    return text(snapshot);
  }, true);
  tool('browser_click', 'Click an element using native browser input.', { ...targeting, doubleClick: z.boolean().optional(), button: z.enum(['left', 'right', 'middle']).optional(), modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional() }, async args => text(await sessions.browser.click((await resolveTarget(args))!, args.button, args.doubleClick, args.modifiers)));
  tool('browser_hover', 'Hover over an element using native pointer input.', targeting, async args => text(await sessions.browser.hover((await resolveTarget(args))!)));
  tool('browser_drag', 'Drag an element to another element using native pointer input.', { startElement: element, startTarget: target, startRef: ref.optional(), endElement: element, endTarget: target, endRef: ref.optional() }, async args => text(await sessions.browser.drag((await resolveTarget({ target: args.startTarget, ref: args.startRef }))!, (await resolveTarget({ target: args.endTarget, ref: args.endRef }))!)));
  tool('browser_select_option', 'Select options by value in a native select element.', { ...targeting, values: z.array(z.string()).min(1) }, async args => text(await sessions.browser.selectOption((await resolveTarget(args))!, args.values)));
  tool('browser_type', 'Type text into an editable element. By default replaces the existing text; slowly preserves it.', { ...targeting, text: z.string().max(100000), submit: z.boolean().optional(), slowly: z.boolean().optional() }, async args => text(await sessions.browser.type((await resolveTarget(args))!, args.text, args.submit, args.slowly)));
  tool('browser_press_key', 'Press a key or combination such as Enter, ArrowDown, or Control+A.', { key: z.string() }, async args => { await sessions.browser.pressKey(args.key); return text(await sessions.browser.snapshot()); });
  tool('browser_handle_dialog', 'Accept or dismiss the open browser dialog and resume the operation that opened it.', { accept: z.boolean(), promptText: z.string().optional() }, async args => text(await sessions.browser.handleDialog(args.accept, args.promptText)));
  tool('browser_file_upload', 'Select files in the open file chooser. Omit paths to cancel. Uses the native browser file selection pipeline.', { paths: z.array(z.string()).max(100).optional() }, async args => text(await sessions.browser.upload(args.paths)));
  tool('browser_evaluate', 'Evaluate a JavaScript function in the page, or a function taking the referenced element as its argument. Promises are awaited.', { function: z.string().max(2 * 1024 * 1024), ...targeting }, async args => text(await sessions.browser.evaluate(args.function, await resolveTarget(args, false))));
  tool('browser_take_screenshot', 'Take a PNG screenshot of the viewport, full document, or referenced element without scrolling or focusing the window.', { type: z.literal('png').optional(), fullPage: z.boolean().optional(), ...targeting, filename: z.string().optional() }, async args => {
    const result = await sessions.browser.screenshot(args.fullPage, await resolveTarget(args, false));
    if (args.filename) await Bun.write(args.filename, Buffer.from(result.data, 'base64'));
    return { content: [{ type: 'image', mimeType: 'image/png', data: result.data }, ...(args.filename ? text(`Saved ${args.filename}`).content : [])] };
  }, true);
  tool('derpbird_take_window_screenshot', 'Take a PNG of the selected browser window, including chrome and both split panes, without activating it or capturing other desktop windows.', { filename: z.string().optional() }, async args => {
    const result = await sessions.browser.windowScreenshot();
    if (args.filename) await Bun.write(args.filename, Buffer.from(result.data, 'base64'));
    return { content: [{ type: 'image', mimeType: 'image/png', data: result.data }, ...(args.filename ? text(`Saved ${args.filename}`).content : [])] };
  }, true);
  tool('browser_console_messages', 'Return captured console messages for the selected tab.', { level: z.enum(['error', 'warning', 'info', 'debug']).default('info') }, async args => { await sessions.browser.target(); return text(sessions.browser.consoleMessages(args.level)); }, true);
  tool('browser_network_requests', 'Return captured network events for the selected tab.', {}, async () => { await sessions.browser.target(); return text(sessions.browser.networkRequests()); }, true);
  tool('derpbird_inspect', 'Inspect an element DOM, computed styles and layout, or open the browser’s native DevTools for the selected tab.', { ref: ref.optional(), properties: z.array(z.string()).optional(), openDevTools: z.boolean().optional() }, async args => {
    if (args.openDevTools) await sessions.browser.openDevTools();
    if (args.ref) return text(await sessions.browser.inspect(args.ref, args.properties));
    return text(await sessions.browser.snapshot());
  });
  tool('derpbird_devtools', 'Open native DevTools and query its DOM, styles, console, script sources and network capture. Start with snapshot, reload to capture requests, then read response/source by ID. Shares the visible inspector; clear clears its network log. Response capture has the same size and binary limits as native DevTools.', { action: z.enum(['snapshot', 'response', 'source', 'refresh', 'clear']), id: z.string().optional() }, async args => text(await sessions.browser.devtools(args.action, args.id)));
  tool('browser_resize', 'Resize the browser window containing the selected tab.', { width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) }, async args => { await sessions.browser.currentShell({ type: 'automation.resize', ...args }); return text(await sessions.browser.snapshot()); });
  tool('browser_wait_for', 'Wait for text to appear, disappear, or a specified time in seconds.', { text: z.string().optional(), textGone: z.string().optional(), time: z.number().nonnegative().max(30).optional() }, async args => {
    if (args.time !== undefined && args.text === undefined && args.textGone === undefined) await new Promise(resolve => setTimeout(resolve, args.time! * 1000));
    if (args.text !== undefined || args.textGone !== undefined) {
      const deadline = Date.now() + (args.time ?? 30) * 1000;
      for (;;) {
        const visible = await sessions.browser.evaluate('() => document.body?.innerText ?? ""');
        if ((args.text !== undefined && visible.includes(args.text)) || (args.textGone !== undefined && !visible.includes(args.textGone))) break;
        if (Date.now() >= deadline) throw new Error('Timed out waiting for page text');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return text(await sessions.browser.snapshot());
  });
  tool('browser_close', 'Close the owned agent browser, or disconnect from an attached user browser without closing it.', {}, async () => { await sessions.close(); return text('Browser session disconnected'); });
  tool('derpbird_shell', 'Read shell state (including IDs), or operate workspaces, split view, tab trees and windows. Omit command to inspect. Commands use IDs from this state, not browser_tabs indices.', { command: z.object({
    type: z.enum(['workspace.switch', 'workspace.create', 'workspace.update', 'window.new', 'window.minimize', 'window.maximize', 'window.close', 'tab.activate', 'tab.duplicate', 'tab.new-child', 'tab.ungroup', 'tab.close-group', 'tab.close-others', 'tab.close-right', 'tab.pin', 'tab.mute', 'tab.move', 'tab.tree-move', 'tab.split', 'split.switch', 'split.resize', 'tab.reopen', 'tab.inspect', 'tab.zoom-in', 'tab.zoom-out', 'tab.zoom-reset', 'browser.open-page', 'shell.set-chrome-layout', 'shell.set-sidebar-width', 'shell.set-wrap-tabs', 'script.command']),
    tabId: z.string().optional().describe('Tab ID for tab commands and split.switch/split.resize; a split is addressed through either member tab, not its split ID'), targetId: z.string().optional().describe('Other tab for split/tree-move'),
    id: z.string().optional().describe('Workspace ID for switch/update, or scriptCommands ID for script.command'), name: z.string().max(32).optional(),
    icon: z.enum(['research', 'home', 'code', 'leaf']).optional(), color: z.enum(['sage', 'peach', 'lilac', 'blue']).optional(),
    url: z.string().optional(), private: z.boolean().optional(), value: z.boolean().optional().describe('pin, mute or wrap-tabs value'),
    index: z.number().int().nonnegative().optional(), placement: z.enum(['before', 'inside', 'after']).optional(),
    edge: z.enum(['left', 'right', 'top', 'bottom']).optional(), ratio: z.number().min(0.1).max(0.9).optional(), width: z.number().positive().optional(),
    page: z.enum(['history', 'downloads', 'bookmarks', 'settings']).optional(),
    layout: z.object({ preset: z.enum(['classic', 'sidebar', 'bottom', 'compact']), side: z.enum(['left', 'right']), address: z.enum(['top', 'bottom']) }).optional(),
  }).optional() }, async args => {
    await sessions.browser.target();
    const windowId = sessions.browser.windowId!;
    if (args.command) await sessions.browser.shell(windowId, { type: 'command', command: args.command.type === 'script.command'
      ? { ...args.command, event: { keyboard: false, key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } } : args.command });
    const windows = await sessions.browser.windows();
    return text(windows.some(window => window.windowId === windowId)
      ? await sessions.browser.shell(windowId, { type: 'snapshot' }) : { windows });
  });
  const sourceFields = {
    action: z.enum(['list', 'get', 'save', 'remove', 'enable', 'disable']),
    id: z.string().optional().describe('Existing source ID; omit when saving a new source'),
    source: z.string().max(2 * 1024 * 1024).optional(), name: z.string().optional(),
    revision: z.number().int().nonnegative().optional().describe('Expected registry revision, returned by list/get'),
  };
  tool('derpbird_userscript', 'Manage persistent userscripts in the selected browser profile through the real GM runtime. Metadata, grants, dependencies and run-at are enforced by DerpBird. Reload the page to test loading phases. Use an isolated session for disposable tests.', sourceFields, async args => text(await manageSource(sessions.browser, 'scripts', args)));
  tool('derpbird_userstyle', 'Manage persistent UserCSS/styles in the selected browser profile using the normal compiler and matching rules. Changes apply through the native style manager. Use an isolated session for disposable tests.', { ...sourceFields, values: z.record(z.string(), z.union([z.string(), z.number()])).optional() }, async args => text(await manageSource(sessions.browser, 'styles', args)));
  return server;
}

if (import.meta.main) {
  const sessions = new AgentSessions();
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`DerpBird MCP browser adapter

Usage: bun src/automation/server.ts [--isolated | --socket PATH]

--isolated      Open a separate agent window with a disposable profile.
--socket PATH   Attach to an enabled browser. Disconnect never closes it.
No arguments   Let the agent use derpbird_session to launch or attach.

In your browser: Menu > Allow AI access to all windows, or Ctrl+Alt+A.
The agent can discover enabled browsers with derpbird_session(discover).
AI · Stop revokes all connections. The socket path is in its tooltip.

MCP client config (replace the path with your checkout):
{"mcpServers":{"derpbird":{"command":"bun","args":["/absolute/path/DerpBird/src/automation/server.ts"]}}}

Build first with: python3 scripts/workflow.py build
The server inherits your desktop display environment.
For Codex, forward it explicitly in ~/.codex/config.toml:
[mcp_servers.derpbird]
env_vars = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "QT_QPA_PLATFORM"]

Uses familiar Playwright MCP browser_* tools over native WebDriver BiDi.
Supports target CSS selectors and snapshot refs (legacy ref also accepted).
This is not a Playwright runtime or a CDP endpoint. browser_evaluate runs page
JavaScript, not arbitrary Playwright code. Snapshots include up to 32 frames;
CSS selectors address the top document, while snapshot refs also address frames.
Screenshots are PNG. Source tools install persistent profile entries; use an
isolated session for disposable GM/UserCSS tests. Reload tests loading phases.
derpbird_devtools shares the native inspector, including its capture limits.
Access covers the selected browser process, including all its windows.
`);
    process.exit(0);
  }
  const socketIndex = args.indexOf('--socket');
  if (socketIndex >= 0) {
    const socket = args[socketIndex + 1]; if (!socket) throw new Error('--socket requires a path');
    await sessions.attach(socket);
  } else if (args.includes('--isolated')) await sessions.launch();
  const server = createAgentServer(sessions);
  server.server.onclose = () => { void sessions.closeAll(); };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void sessions.closeAll().finally(() => process.exit(0)); });
  await server.connect(new StdioServerTransport());
}
