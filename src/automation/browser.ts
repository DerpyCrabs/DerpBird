import { scriptResult, type BrowserConnection, type BrowserEvent } from './connection';

export interface AgentTab { id: string; context?: string; url: string; title: string; active: boolean; workspace: string; windowId: string; fileChooser?: boolean }
export interface AgentWindow { windowId: string; agentId?: string; activityFeedback?: boolean; profile: string; private: boolean; tabs: Omit<AgentTab, 'windowId'>[] }
interface ElementReference { sharedId: string; context: string; tabContext: string }

/** Familiar browser tool operations, with native BiDi input and document-scoped refs. */
export class AgentBrowser {
  context: string | undefined;
  windowId: string | undefined;
  private ownedWindow?: string;
  restrictToWindow(id: string) { this.ownedWindow = id; }
  private references = new Map<string, ElementReference>();
  private nextRef = 0;
  private needsSettle = new Set<string>();
  private events: BrowserEvent[] = [];
  private pendingOperation: { completion: Promise<unknown>; context: string } | undefined;
  private unsubscribe: () => void;
  constructor(readonly connection: BrowserConnection) {
    this.unsubscribe = connection.subscribe(event => {
      this.events.push(event);
      if (this.events.length > 2000) this.events.shift();
      if (event.method === 'browsingContext.navigationStarted' || event.method === 'browsingContext.contextDestroyed') {
        for (const [ref, value] of this.references) if (value.context === event.params.context || value.tabContext === event.params.context) this.references.delete(ref);
      }
    });
  }
  close() { this.unsubscribe(); this.connection.close(); }
  /** A page prompt suspends the original script/input. Return control so the next tool can answer it. */
  private async run<T = any>(method: string, params: Record<string, unknown>, context: string): Promise<T> {
    if (this.pendingOperation) throw new Error('A browser dialog is awaiting browser_handle_dialog; the previous operation is still suspended');
    const input = method === 'input.performActions';
    if (input) this.needsSettle.add(context);
    const feedback = input || method === 'script.callFunction';
    if (feedback) await this.activity(context, input ? 'input' : 'evaluate', params);
    const heartbeat = feedback ? setInterval(() => { void this.activity(context, 'keepalive').catch(() => {}); }, 700) : undefined;
    try { return await this.observe(this.connection.request<T>(method, params), context); }
    finally { clearInterval(heartbeat); if (feedback) await this.activity(context, 'end').catch(() => {}); }
  }
  private async activity(context: string, phase: string, params: Record<string, any> = {}) {
    const windows = await this.windows();
    const window = windows.find(w => w.tabs.some(t => t.context === this.context));
    if (!window?.activityFeedback) return;
    const tab = window.tabs.find(t => t.context === this.context)!;
    let kind = phase;
    let point: any, from: any, field: any;
    if (phase === 'input') {
      const sources = params.actions ?? [];
      const pointer = sources.find((s: any) => s.type === 'pointer');
      kind = pointer ? (pointer.actions.filter((a: any) => a.type === 'pointerMove').length > 1 ? 'drag' : pointer.actions.some((a: any) => a.type === 'pointerDown') ? 'click' : 'move') : sources.some((s: any) => s.type === 'wheel') ? 'scroll' : 'type';
      // Frame-local coordinates cannot be drawn in the top viewport without a transform.
      // Keep a truthful activity status for those operations instead of a misplaced pointer.
      if (context === this.context) {
        const moves = (pointer?.actions ?? []).filter((a: any) => a.type === 'pointerMove');
        const locate = async (move: any) => {
          if (move.origin?.type === 'element') return scriptResult(await this.connection.request('script.callFunction', {
            target: { context }, functionDeclaration: `el => { const r=el.getClientRects()[0]; if(!r)return null; return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2}; }`,
            arguments: [{sharedId:move.origin.element.sharedId}], awaitPromise:false,
          }));
          return (!move.origin || move.origin === 'viewport') ? {x:move.x,y:move.y} : undefined;
        };
        if (moves.length) { from = await locate(moves[0]); point = await locate(moves[moves.length-1]); }
        const wheel=sources.find((s:any)=>s.type==='wheel')?.actions.find((a:any)=>a.type==='scroll');
        if(wheel) point={x:wheel.x,y:wheel.y};
      }
    }
    if (kind === 'type' && context === this.context) field = scriptResult(await this.connection.request('script.callFunction', {
      target:{context}, functionDeclaration:`() => {const e=document.activeElement;if(!e||e===document.body)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}`,awaitPromise:false,
    }));
    await this.shell(window.windowId, {type:'automation.activity',tabId:tab.id,kind,point,from,field});
  }
  private async settle() {
    const contexts = [...this.needsSettle]; this.needsSettle.clear();
    for (const context of contexts) {
      if (this.pendingOperation) return;
      try { await this.connection.request('script.callFunction', {
        target:{context}, awaitPromise:true,
        functionDeclaration:`() => new Promise(resolve => {
          let quiet; const done=()=>{clearTimeout(quiet);clearTimeout(cap);observer.disconnect();resolve();};
          const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,80);});
          observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
          const cap=setTimeout(done,600);quiet=setTimeout(done,80);
        })`,
      }); } catch (error) {
        // Navigation can replace the input document. Snapshot targets the new document.
        if (!/no such|discarded|destroyed|navigation|realm/i.test(String(error))) throw error;
      }
    }
  }
  private async observe<T>(request: Promise<T>, context: string): Promise<T> {
    let settled = false, monitoring = true;
    const operation = request.finally(() => { settled = true; });
    const prompt = (async () => {
      while (monitoring && !settled) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!monitoring || settled) break;
        const dialog = await this.connection.request('derpbird.dialog', { context });
        if (!settled && dialog) {
          const pending = { completion: operation, context };
          this.pendingOperation = pending;
          void operation.finally(() => { if (this.pendingOperation === pending) this.pendingOperation = undefined; }).catch(() => {});
          throw new Error(`${dialog.type} dialog: ${dialog.message ?? ''}. Use browser_handle_dialog to continue the suspended operation.`);
        }
      }
      return new Promise<never>(() => {});
    })();
    try { return await Promise.race([operation, prompt]); }
    finally { monitoring = false; }
  }
  private async release(context: string) {
    if (this.pendingOperation) {
      void this.pendingOperation.completion.then(() => this.connection.request('input.releaseActions', { context })).catch(() => {});
    } else await this.connection.request('input.releaseActions', { context });
  }
  async handleDialog(accept: boolean, promptText?: string) {
    const pending = this.pendingOperation;
    const context = pending?.context ?? await this.target();
    await this.connection.request('browsingContext.handleUserPrompt', { context, accept, ...(promptText !== undefined ? { userText: promptText } : {}) });
    this.pendingOperation = undefined;
    return { ...(pending ? { completedOperation: await this.observe(pending.completion, context) } : {}), snapshot: await this.snapshot() };
  }
  async upload(paths: string[] = []) {
    const context = await this.target(), tab = (await this.tabs()).find(tab => tab.context === context)!;
    await this.shell(tab.windowId, { type: 'automation.files', tabId: tab.id, paths });
    return this.snapshot();
  }
  async windows(): Promise<AgentWindow[]> {
    const { windows } = await this.connection.request('derpbird.windows');
    return this.ownedWindow ? windows.filter((window: AgentWindow) => window.windowId === this.ownedWindow) : windows;
  }
  async tabs(): Promise<AgentTab[]> { return (await this.windows()).flatMap(window => window.tabs.map(tab => ({ ...tab, windowId: window.windowId }))); }
  async select(index: number) {
    const tab = (await this.tabs())[index];
    if (!tab) throw new Error('Tab index does not exist; call browser_tabs with action=list');
    await this.shell(tab.windowId, { type: 'command', command: { type: 'tab.activate', tabId: tab.id } });
    const selected = (await this.tabs()).find(value => value.id === tab.id && value.windowId === tab.windowId);
    if (!selected?.context) throw new Error('Tab is not ready; retry after it loads');
    await this.waitReady(selected.context);
    this.context = selected.context; this.windowId = tab.windowId;
    return this.snapshot();
  }
  async target(): Promise<string> {
    const tabs = await this.tabs();
    if (this.context) {
      if (!tabs.some(tab => tab.context === this.context)) throw new Error('Selected tab closed; select another tab');
      return this.context;
    }
    const windows = new Set(tabs.map(tab => tab.windowId));
    if (windows.size !== 1) throw new Error('Several browser windows are available. List tabs and explicitly select the intended tab.');
    const active = tabs.find(tab => tab.active) ?? tabs[0];
    if (!active?.context) throw new Error('No loaded tab available. List tabs and select a tab.');
    await this.waitReady(active.context);
    this.context = active.context; this.windowId = active.windowId;
    return active.context;
  }
  private async waitReady(context: string) {
    const deadline = Date.now() + 15000;
    for (;;) {
      const tree = await this.connection.request('browsingContext.getTree', { maxDepth: 0 });
      if (tree.contexts.some((item: any) => item.context === context)) return;
      if (Date.now() >= deadline) throw new Error('Selected tab did not become ready for automation');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  shell(windowId: string, payload: Record<string, unknown>) {
    if (this.ownedWindow && windowId !== this.ownedWindow) throw new Error('Window is outside this agent session');
    return this.connection.request('derpbird.request', { windowId, payload });
  }
  async currentShell(payload: Record<string, unknown>) { await this.target(); return this.shell(this.windowId!, payload); }
  async navigate(url: string) {
    const context = await this.target();
    await this.run('browsingContext.navigate', { context, url, wait: 'complete' }, context);
    return this.snapshot();
  }
  async back() {
    const context = await this.target();
    // A traversal is acknowledged before its document changes. Entry keys also distinguish
    // same-document history entries (including two entries with the same URL).
    const previous = await this.evaluate('() => navigation.currentEntry?.key');
    if (!previous) throw new Error('Cannot observe history traversal in this document');
    await this.run('browsingContext.traverseHistory', { context, delta: -1 }, context);
    const deadline = Date.now() + 30000;
    for (;;) {
      const current = await this.evaluate('() => ({ key: navigation.currentEntry?.key, ready: document.readyState })');
      if (current.key && current.key !== previous && current.ready === 'complete') break;
      if (Date.now() >= deadline) throw new Error('History traversal did not finish within 30 seconds');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return this.snapshot();
  }
  async reload() { const context = await this.target(); await this.run('browsingContext.reload', { context, wait: 'complete' }, context); return this.snapshot(); }
  async newTab() {
    await this.target();
    const existing = new Set((await this.tabs()).map(tab => tab.id));
    const window = (await this.windows()).find(window => window.windowId === this.windowId)!;
    await this.currentShell({ type: 'command', command: { type: 'tab.create', url: 'about:blank', private: window.private } });
    const deadline = Date.now() + 15000;
    let tab: AgentTab | undefined;
    while (!(tab = (await this.tabs()).find(tab => tab.windowId === this.windowId && !existing.has(tab.id) && tab.context))) {
      if (Date.now() >= deadline) throw new Error('New tab did not become available');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await this.waitReady(tab.context!);
    this.context = tab.context;
    return this.snapshot();
  }
  async closeTab(index?: number) {
    const tabs = await this.tabs();
    const tab = index === undefined ? tabs.find(tab => tab.context === this.context) : tabs[index];
    if (!tab?.context) throw new Error('Select an available tab first');
    await this.shell(tab.windowId, { type: 'command', command: { type: 'tab.close', tabId: tab.id } });
    if (tab.context === this.context) { this.context = undefined; this.windowId = undefined; }
    return this.tabs();
  }
  private reference(ref: string): ElementReference {
    const element = this.references.get(ref);
    if (!element || element.tabContext !== this.context) throw new Error('Stale or unknown element reference: the document or element changed. Take browser_snapshot again, or use a unique CSS target. The action was not retried.');
    return element;
  }
  async resolveTarget(target: string): Promise<string> {
    await this.target();
    if (/^e\d+$/.test(target)) { this.reference(target); return target; }
    const node = await this.evaluate(`() => {
      const nodes = document.querySelectorAll(${JSON.stringify(target)});
      if (nodes.length !== 1) throw Error('Selector must match exactly one element; matched '+nodes.length);
      return nodes[0];
    }`);
    if (!node?.sharedId) throw new Error('Selector did not resolve to an element');
    const existing = [...this.references].find(([, value]) => value.context === this.context && value.sharedId === node.sharedId);
    if (existing) return existing[0];
    const ref = `e${++this.nextRef}`;
    this.references.set(ref, { context: this.context!, tabContext: this.context!, sharedId: node.sharedId });
    return ref;
  }
  async snapshot(ref?: string, maxDepth = 30): Promise<string> {
    const context = await this.target();
    const dialog = await this.connection.request('derpbird.dialog', { context });
    if (dialog) return `Open ${dialog.type} dialog: ${dialog.message ?? ''}\nUse browser_handle_dialog to continue.`;
    if ((await this.tabs()).find(tab => tab.context === context)?.fileChooser) return 'File chooser open. Use browser_file_upload with absolute paths, or omit paths to cancel.';
    await this.settle();
    const reference = ref ? this.reference(ref) : undefined;
    let tree = await this.connection.request('derpbird.snapshot', { context: reference?.context ?? context });
    const frameTrees: { context: string; url: string; tree: any }[] = [];
    if (!ref) {
      const frames = await this.connection.request('browsingContext.getTree', { root: context, maxDepth: 8 });
      const collect = async (node: any) => {
        for (const child of node.children ?? []) {
          if (frameTrees.length >= 32) return;
          try { frameTrees.push({ context: child.context, url: child.url, tree: await this.connection.request('derpbird.snapshot', { context: child.context }) }); }
          catch { frameTrees.push({ context: child.context, url: child.url, tree: { role: 'document', name: 'Frame navigated or is unavailable; take another snapshot' } }); }
          await collect(child);
        }
      };
      for (const root of frames.contexts) await collect(root);
    }
    if (ref) {
      const { sharedId } = this.reference(ref);
      const find = (node: any): any => node.sharedId === sharedId ? node : (node.children ?? []).map(find).find(Boolean);
      tree = find(tree);
      if (!tree) throw new Error('Element is not present in the accessibility tree');
    }
    const previous = new Map([...this.references].map(([id, value]) => [`${value.context}:${value.sharedId}`, id]));
    // A new snapshot must not invalidate handles to unchanged DOM nodes.
    // Scoped/depth-limited snapshots also leave other handles intact until navigation.
    while (this.references.size > 10000) this.references.delete(this.references.keys().next().value!);
    const lines: string[] = [];
    const walk = (node: any, depth: number, frameContext: string) => {
      if (lines.length >= 3000 || depth > maxDepth) return;
      let ref = '';
      if (node.sharedId && node.type === 'element') {
        ref = previous.get(`${frameContext}:${node.sharedId}`) ?? `e${++this.nextRef}`;
        this.references.set(ref, { sharedId: node.sharedId, context: frameContext, tabContext: context });
      }
      const role = node.role || (node.type === 'text' ? 'text' : 'generic');
      if (node.name || ref || role === 'document') lines.push(`${'  '.repeat(Math.min(depth, 30))}- ${role}${node.name ? ' ' + JSON.stringify(node.name) : ''}${ref ? ` [ref=${ref}]` : ''}`);
      for (const child of node.children ?? []) walk(child, depth + 1, frameContext);
    };
    walk(tree, 0, reference?.context ?? context);
    for (const frame of frameTrees) { lines.push(`- iframe ${JSON.stringify(frame.url)}`); walk(frame.tree, 1, frame.context); }
    if (frameTrees.length >= 32) lines.push('- Frame snapshot limit reached (32 frames).');
    if (lines.length >= 3000) lines.push('- Snapshot truncated; inspect a smaller part of the page with browser_evaluate.');
    const tab = (await this.tabs()).find(tab => tab.context === context);
    return `Page URL: ${tab?.url}\nPage Title: ${tab?.title}\n\n${lines.join('\n')}`;
  }
  async evaluate(functionDeclaration: string, ref?: string) {
    const context = await this.target();
    const element = ref ? this.reference(ref) : undefined;
    const args = element ? [{ sharedId: element.sharedId }] : [];
    return scriptResult(await this.run('script.callFunction', {
      target: { context: element?.context ?? context }, functionDeclaration, arguments: args, awaitPromise: true,
      serializationOptions: { maxObjectDepth: 8, maxDomDepth: 1 },
    }, element?.context ?? context));
  }
  private async actions(actions: unknown[], context?: string) { context ??= await this.target(); return this.run('input.performActions', { context, actions }, context); }
  private async actionable(ref: string) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const reason = await this.evaluate(`el => {
        if (!el.isConnected) throw Error('Detached element');
        el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
        const r=el.getBoundingClientRect(), style=getComputedStyle(el);
        if (!r.width || !r.height || style.visibility==='hidden' || style.display==='none' || el.disabled) return 'Element is not actionable';
        const top=el.ownerDocument.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return top===el || el.contains(top) ? null : 'Element is covered';
      }`, ref);
      if (!reason) return;
      if (Date.now() >= deadline) throw new Error(reason);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  async click(ref: string, button = 'left', doubleClick = false, modifiers: string[] = []) {
    await this.target();
    const element = this.reference(ref);
    await this.actionable(ref);
    const buttonId = { left: 0, middle: 1, right: 2 }[button];
    if (buttonId === undefined) throw new Error('Unsupported pointer button');
    const pointer: any[] = [{ type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: element.sharedId } } }];
    for (let i = 0; i < (doubleClick ? 2 : 1); i++) pointer.push({ type: 'pointerDown', button: buttonId }, { type: 'pointerUp', button: buttonId });
    const keys = modifiers.map(keyCode);
    try {
      if (keys.length) await this.actions([{ type: 'key', id: 'keyboard', actions: keys.map(value => ({ type: 'keyDown', value })) }], element.context);
      await this.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: pointer }], element.context);
    } finally { await this.release(element.context); }
    return this.snapshot();
  }
  async type(ref: string, text: string, submit = false, slowly = false) {
    await this.target(); const context = this.reference(ref).context;
    await this.actionable(ref);
    await this.evaluate(`el => { if(!el.isConnected || el.disabled || el.readOnly || !(el.isContentEditable || el.localName==='textarea' || (el.localName==='input' && ['text','search','url','tel','email','password','number'].includes(el.type)))) throw Error('Element is not editable'); el.focus(); }`, ref);
    if (!slowly) await this.pressKey('Control+A', context);
    for (let start = 0, chars = Array.from(text); start < chars.length; start += 128) {
      await this.actions([{ type: 'key', id: 'keyboard', actions: chars.slice(start, start + 128).flatMap(value => [{ type: 'keyDown', value }, { type: 'keyUp', value }]) }], context);
    }
    if (!text && !slowly) await this.pressKey('Backspace', context);
    if (submit) await this.pressKey('Enter', context);
    return this.snapshot();
  }
  async pressKey(key: string, context?: string) {
    context ??= await this.target();
    const keys = key.split('+').map(keyCode);
    try { await this.actions([{ type: 'key', id: 'keyboard', actions: [...keys.map(value => ({ type: 'keyDown', value })), ...keys.toReversed().map(value => ({ type: 'keyUp', value }))] }], context); }
    finally { await this.release(context); }
  }
  async windowScreenshot(): Promise<{ data: string }> {
    return this.currentShell({ type: 'automation.screenshot' });
  }
  async screenshot(fullPage = false, ref?: string) {
    if (fullPage && ref) throw new Error('fullPage cannot be combined with an element screenshot');
    const context = await this.target();
    return this.connection.request<{ data: string }>('browsingContext.captureScreenshot', {
      context: ref ? this.reference(ref).context : context, origin: fullPage ? 'document' : 'viewport', format: { type: 'image/png' },
      ...(ref ? { clip: { type: 'element', element: { sharedId: this.reference(ref).sharedId } } } : {}),
    });
  }
  async hover(ref: string) {
    await this.target();
    await this.actionable(ref);
    await this.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: this.reference(ref).sharedId } } },
    ] }], this.reference(ref).context);
    return this.snapshot();
  }
  async scroll(deltaY: number, deltaX = 0, ref?: string) {
    const context = ref ? this.reference(ref).context : await this.target();
    if (ref) await this.actionable(ref);
    const position = ref ? await this.evaluate(`el => {const r=el.getBoundingClientRect();return {x:Math.floor((Math.max(0,r.left)+Math.min(innerWidth,r.right))/2),y:Math.floor((Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2)}}`,ref)
      : await this.evaluate('()=>({x:Math.floor(innerWidth/2),y:Math.floor(innerHeight/2)})');
    await this.actions([{type:'wheel',id:'wheel',actions:[{type:'scroll',...position,deltaX,deltaY,duration:250,origin:'viewport'}]}],context);
    return this.snapshot();
  }
  async drag(startRef: string, endRef: string) {
    await this.target();
    await this.actionable(startRef);
    const start = this.reference(startRef), end = this.reference(endRef);
    if (start.context !== end.context) throw new Error('Drag across different frames is not supported');
    try {
      await this.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: start.sharedId } } },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', x: 0, y: 0, duration: 300, origin: { type: 'element', element: { sharedId: end.sharedId } } },
        { type: 'pointerUp', button: 0 },
      ] }], start.context);
    } finally { await this.release(start.context); }
    return this.snapshot();
  }
  async selectOption(ref: string, values: string[]) {
    await this.target();
    await this.actionable(ref);
    await this.evaluate(`el => {
      if (el.localName !== 'select') throw Error('Element is not a select');
      const values = ${JSON.stringify(values)}, options = Array.from(el.options);
      if (!el.multiple && values.length > 1) throw Error('Select only accepts one option');
      for (const value of values) if (!options.some(o => o.value === value && !o.disabled && !o.parentElement.disabled)) throw Error('Option not available: '+value);
      for (const option of options) option.selected = values.includes(option.value);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    }`, ref);
    return this.snapshot();
  }
  async inspect(ref: string, properties = ['display', 'visibility', 'position', 'color', 'background-color', 'font-family', 'font-size', 'margin', 'padding', 'width', 'height']) {
    return this.evaluate(`el => {
      const computed = getComputedStyle(el);
      return { html: el.outerHTML.slice(0, 65536), rect: el.getBoundingClientRect().toJSON(),
        styles: Object.fromEntries(${JSON.stringify(properties)}.map(name => [name, computed.getPropertyValue(name)])) };
    }`, ref);
  }
  async openDevTools() {
    const context = await this.target(), tab = (await this.tabs()).find(tab => tab.context === context)!;
    return this.shell(tab.windowId, { type: 'command', command: { type: 'tab.inspect', tabId: tab.id } });
  }
  async devtools(action: 'snapshot' | 'response' | 'source' | 'refresh' | 'clear', id?: string) {
    const context = await this.target(), tab = (await this.tabs()).find(tab => tab.context === context)!;
    if ((action === 'response' || action === 'source') && !id) throw new Error('id from the DevTools snapshot is required');
    return this.shell(tab.windowId, { type: 'automation.devtools', tabId: tab.id, request: { type: `devtools.${action}`, ...(id ? { id } : {}) } });
  }
  consoleMessages(level = 'info') {
    const levels = ['debug', 'info', 'warn', 'error'];
    return this.events.filter(event => event.method === 'log.entryAdded' && (!this.context || event.params.source?.context === this.context) && levels.indexOf(event.params.level) >= levels.indexOf(level === 'warning' ? 'warn' : level)).map(event => event.params);
  }
  networkRequests(options: {url?:string;method?:string;status?:number;offset?:number;limit?:number;details?:boolean} = {}) {
    const events = this.events.filter(event => event.method.startsWith('network.') && (!this.context || event.params.context === this.context))
      .filter(event => (!options.url || String(event.params.request?.url ?? event.params.response?.url ?? '').includes(options.url))
        && (!options.method || event.params.request?.method?.toUpperCase() === options.method.toUpperCase())
        && (options.status === undefined || event.params.response?.status === options.status));
    const offset=options.offset??0,limit=Math.min(200,Math.max(1,options.limit??50));
    const page=events.slice(offset,offset+limit);
    return {total:events.length,offset,nextOffset:offset+page.length<events.length?offset+page.length:null,events:page.map(event => options.details ? {event:event.method,...event.params} : {
      event:event.method,id:event.params.request?.request,url:event.params.request?.url ?? event.params.response?.url,
      method:event.params.request?.method,status:event.params.response?.status,mimeType:event.params.response?.mimeType,
    })};
  }
}

function keyCode(key: string): string {
  const special: Record<string, string> = { Enter: '\uE007', Tab: '\uE004', Escape: '\uE00C', Backspace: '\uE003', Delete: '\uE017', ArrowLeft: '\uE012', ArrowUp: '\uE013', ArrowRight: '\uE014', ArrowDown: '\uE015', Home: '\uE011', End: '\uE010', PageUp: '\uE00E', PageDown: '\uE00F', Shift: '\uE008', Control: '\uE009', ControlOrMeta: '\uE009', Alt: '\uE00A', Meta: '\uE03D', Space: ' ' };
  if (special[key]) return special[key];
  if (Array.from(key).length === 1) return key;
  throw new Error(`Unsupported key: ${key}`);
}
