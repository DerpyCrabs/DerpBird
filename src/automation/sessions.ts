import { stat, readdir, realpath, readFile } from 'node:fs/promises';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NativeConnection } from './connection';
import { AgentBrowser } from './browser';

interface Session { id: string; mode: 'attached' | 'agent-window'; socket: string; browser: AgentBrowser; ownedWindow?: string; log?: () => string }
export class AgentSessions {
  private sessions = new Map<string, Session>();
  private selected: string | undefined;
  private nextId = 0;
  constructor(private root = resolve(import.meta.dir, '../..')) {}
  list() { return [...this.sessions.values()].map(({ id, mode, socket }) => ({ id, mode, socket, selected: id === this.selected })); }
  diagnostics() { return [...this.sessions.values()].map(session => ({ id: session.id, stderr: session.log?.() })); }
  get browser() {
    const session = this.selected ? this.sessions.get(this.selected) : undefined;
    if (!session) throw new Error('No browser session. Use derpbird_session to open an agent window on your profile or attach to your browser.');
    return session.browser;
  }
  select(id: string) { if (!this.sessions.has(id)) throw new Error('Unknown session'); this.selected = id; return this.list(); }
  async discover() {
    const directory = process.env.XDG_RUNTIME_DIR || (process.getuid ? `/run/user/${process.getuid()}` : join(tmpdir(), `runtime-${userInfo().username}`));
    const candidates = await readdir(directory).catch(() => []);
    const available = [];
    for (const name of candidates.filter(name => /^derpbird-automation-\d+\.sock$/.test(name))) {
      const socket = join(directory, name);
      let connection: NativeConnection | undefined;
      try {
        const info = await stat(socket);
        if (!info.isSocket() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) continue;
        connection = await NativeConnection.connect(socket);
        available.push({ socket, ...(await connection.request('derpbird.windows')) });
      } catch { /* Ignore stale sockets belonging to browsers that have exited. */ }
      finally { connection?.close(); }
    }
    return available;
  }
  async attach(socket: string) {
    const info = await stat(socket);
    if (!info.isSocket() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) throw new Error('Expected an owner-only browser socket owned by the current user');
    const browser = new AgentBrowser(await NativeConnection.connect(socket));
    try { await browser.windows(); } catch (error) { browser.close(); throw error; }
    const id = `session-${++this.nextId}`;
    this.sessions.set(id, { id, mode: 'attached', socket, browser }); this.selected = id;
    return this.list();
  }
  async launch() {
    const profile = resolve(process.env.DERPBIRD_PROFILE || join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'derpbird/profile'));
    const profileData = await realpath(join(profile, 'data')).catch(() => join(profile, 'data'));
    const agentId = crypto.randomUUID();
    const findBrowser = async () => (await this.discover()).find((entry: any) => entry.windows?.some((window: any) => window.profile === profileData && !window.private));
    let available = await findBrowser();
    let stderr = '';
    if (!available) {
      const pid = Number(await readFile(join(profile, 'runtime/Ladybird.pid'), 'utf8').catch(() => ''));
      let running = false;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); running = true; } catch (error: any) { running = error.code === 'EPERM'; }
      }
      if (running) throw new Error('This profile is open in an older browser without automatic AI access. Reopen DerpBird to load the installed update; existing tabs and profile have not been touched.');
      const launcher = process.env.DERPBIRD_EXECUTABLE;
      // Use the real profile. The browser's normal single-instance coordination remains authoritative.
      const env = { ...process.env, DERPBIRD_PROFILE: profile, DERPBIRD_AGENT_WINDOW: agentId };
      delete (env as NodeJS.ProcessEnv).DERPBIRD_AUTOMATION_SOCKET;
      delete (env as NodeJS.ProcessEnv).DERPBIRD_AGENT;
      const child = spawn(launcher || 'python3', launcher ? ['about:blank'] : [join(this.root, 'scripts/run.py'), 'about:blank'], {
        cwd: launcher ? tmpdir() : this.root, env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let spawnError: Error | undefined;
      child.on('error', error => { spawnError = error; });
      child.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
      child.stdout?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
      const deadline = Date.now() + 30000;
      while (!(available = await findBrowser())) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode) throw new Error(`The running browser must load the installed update before it can open agent windows on this profile. Your profile was not replaced. Browser output: ${stderr}`);
        if (Date.now() >= deadline) throw new Error(`Browser startup timed out: ${stderr}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      child.unref();
    }
    await this.attach(available.socket);
    const session = this.sessions.get(this.selected!)!;
    try {
      let windows = await session.browser.windows();
      let owned = windows.find(window => window.agentId === agentId);
      if (!owned) {
        const host = windows.find(window => window.profile === profileData && !window.private)!;
        if (host.agentId === undefined) throw new Error('Reopen DerpBird to load the installed agent-window update. Your existing windows have not been changed.');
        await session.browser.shell(host.windowId, { type: 'command', command: { type: 'window.new', private: false, url: 'about:blank', agentId } });
      }
      const deadline = Date.now() + 15000;
      for (;;) {
        windows = await session.browser.windows();
        owned = windows.find(window => window.agentId === agentId);
        if (owned) session.ownedWindow = owned.windowId;
        if (owned?.tabs.some(tab => tab.context)) break;
        if (Date.now() >= deadline) throw new Error('Agent window did not become ready. The running browser may need the installed update.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      session.browser.restrictToWindow(owned!.windowId);
      session.mode = 'agent-window';
      session.log = () => stderr;
      const tabs = await session.browser.tabs();
      await session.browser.select(tabs.findIndex(tab => tab.windowId === owned!.windowId && !!tab.context));
      return this.list();
    } catch (error) { await this.close(session.id); throw error; }
  }
  async close(id = this.selected) {
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown session');
    this.sessions.delete(id);
    if (this.selected === id) this.selected = undefined;
    try {
      if (session.ownedWindow && (await session.browser.windows()).some(window => window.windowId === session.ownedWindow))
        await session.browser.shell(session.ownedWindow, { type: 'command', command: { type: 'window.close' } });
    } finally { session.browser.close(); }
  }
  async closeAll() { for (const id of this.sessions.keys()) await this.close(id); }
}
