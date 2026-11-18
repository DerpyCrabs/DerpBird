import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { AgentSessions } from '../src/automation/sessions';
import { useTestProfile } from './agent-test-profile';

const profile = await useTestProfile();
const settingsPath = profile + '/config/Settings.json';
const settings = await Bun.file(settingsPath).json();
await Bun.write(settingsPath, JSON.stringify({ ...settings, restorePreviousSession: true }));
const sessions = new AgentSessions();
const urls = ['data:text/html,<title>First</title>', 'data:text/html,<title>Second</title>'];
const start = (...args: string[]) => Bun.spawn(
  process.env.DERPBIRD_EXECUTABLE ? [process.env.DERPBIRD_EXECUTABLE, ...args] : ['python3', 'scripts/run.py', ...args],
  { env: { ...process.env, DERPBIRD_PROFILE: profile }, stdout: 'ignore', stderr: 'inherit' },
);
async function until<T>(read: () => Promise<T | undefined>) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    assert(Date.now() < deadline, 'Timed out waiting for test browser');
    await Bun.sleep(100);
  }
}
async function owner() {
  return until(async () => {
    for (const endpoint of await sessions.discover()) {
      const window = endpoint.windows.find((w: any) => w.profile === profile + '/data' && !w.agentId);
      if (window) return { socket: endpoint.socket, window };
    }
  });
}
const initial = start(...urls);
try {
  const user = await owner();
  await sessions.attach(user.socket);
  const ownerBrowser = sessions.browser;
  await sessions.launch();
  const db = new Database(profile + '/data/Sessions.db', { readonly: true });
  const openWindows = db.query('SELECT count(*) AS n FROM Sessions WHERE kind=0');
  assert.equal((openWindows.get() as { n: number }).n, 1);
  assert((await sessions.browser.tabs()).every(tab => tab.windowId !== user.window.windowId));
  await ownerBrowser.shell(user.window.windowId, { type: 'command', command: { type: 'window.close' } }).catch(() => {});
  const exit = await Promise.race([initial.exited, Bun.sleep(10000).then(() => { throw new Error("Browser process still running after owner closed"); })]);
  assert.equal(exit, 0, 'First browser exit: ' + initial.signalCode);
  await sessions.closeAll().catch(() => {});
  assert.equal((db.query('SELECT count(*) AS n FROM Sessions WHERE restore_at_launch=1').get() as { n: number }).n, 1);
  // An agent starts first on the closed profile. A normal launch must still restore the original window.
  await sessions.launch();
  assert.equal((openWindows.get() as { n: number }).n, 0);
  const normal = start();
  try {
    const restored = await owner();
    await sessions.attach(restored.socket);
    const tabs = (await sessions.browser.tabs()).filter(tab => tab.windowId === restored.window.windowId);
    assert.deepEqual(tabs.map(tab => tab.url), urls);
    await sessions.browser.shell(restored.window.windowId, { type: 'command', command: { type: 'window.close' } }).catch(() => {});
    console.log('PASS: both user pages restored in order after closing the user window with an agent open and launching an agent first.');
  } finally { normal.kill(); }
  db.close();
} finally {
  await sessions.closeAll().catch(() => {});
  initial.kill();
}
