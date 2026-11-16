import { mkdtemp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { NativeConnection } from './connection';
import { AgentBrowser } from './browser';

interface Session { id: string; mode: 'attached' | 'isolated'; socket: string; browser: AgentBrowser; process?: ChildProcess; directory?: string; log?: () => string }
export class AgentSessions {
  private sessions = new Map<string, Session>();
  private selected: string | undefined;
  private nextId = 0;
  constructor(private root = resolve(import.meta.dir, '../..')) {}
  list() { return [...this.sessions.values()].map(({ id, mode, socket }) => ({ id, mode, socket, selected: id === this.selected })); }
  diagnostics() { return [...this.sessions.values()].map(session => ({ id: session.id, stderr: session.log?.() })); }
  get browser() {
    const session = this.selected ? this.sessions.get(this.selected) : undefined;
    if (!session) throw new Error('No browser session. Use derpbird_session to launch an isolated browser or attach to your browser.');
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
    if (this.sessions.size >= 8) throw new Error('Close an unused session before opening another browser');
    if (process.platform === 'linux' && !process.env.WAYLAND_DISPLAY && !process.env.DISPLAY && !['offscreen', 'minimal'].includes(process.env.QT_QPA_PLATFORM ?? '')) {
      throw new Error('No desktop display was forwarded to the MCP server. In Codex, add DISPLAY, WAYLAND_DISPLAY and XDG_RUNTIME_DIR to mcp_servers.derpbird.env_vars, then start a new session.');
    }
    const directory = await mkdtemp(join(tmpdir(), 'derpbird-agent-'));
    const profile = join(directory, 'profile'), socket = join(directory, 'browser.sock');
    await mkdir(join(profile, 'data'), { recursive: true, mode: 0o700 });
    await mkdir(join(profile, 'config'), { recursive: true, mode: 0o700 });
    await Bun.write(join(profile, 'data/ImportWelcomeSeen'), '1');
    await Bun.write(join(profile, 'config/Settings.json'), JSON.stringify({ firstRunComplete: true, restorePreviousSession: false, backgroundNetworking: { enabled: false } }));
    const child = spawn('python3', [join(this.root, 'scripts/run.py'), 'about:blank'], {
      cwd: this.root, env: { ...process.env, DERPBIRD_PROFILE: profile, DERPBIRD_AUTOMATION_SOCKET: socket, DERPBIRD_AGENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '', spawnError: Error | undefined;
    child.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
    child.stdout?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
    child.on('error', error => { spawnError = error; });
    try {
      const deadline = Date.now() + 30000;
      for (;;) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode) throw new Error(`Agent browser exited (${child.signalCode ?? child.exitCode}): ${stderr}`);
        try { await stat(socket); break; } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        if (Date.now() >= deadline) throw new Error(`Agent browser startup timed out: ${stderr}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await this.attach(socket);
      const session = this.sessions.get(this.selected!)!;
      Object.assign(session, { mode: 'isolated', process: child, directory, log: () => stderr });
      return this.list();
    } catch (error) { await stop(child); await rm(directory, { recursive: true, force: true }); throw error; }
  }
  async close(id = this.selected) {
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown session');
    this.sessions.delete(id);
    if (this.selected === id) this.selected = undefined;
    session.browser.close();
    // Attaching never transfers ownership of the user's process or profile.
    if (session.process) await stop(session.process);
    if (session.directory) await rm(session.directory, { recursive: true, force: true });
  }
  async closeAll() { for (const id of this.sessions.keys()) await this.close(id); }
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode || !child.pid) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
