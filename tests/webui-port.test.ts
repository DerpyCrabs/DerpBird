import { expect, test } from 'bun:test';
import { createWebUIPort, type WebUIChannel } from '../src/browser/webui-port';
function setup(options = {}) {
  const document = new EventTarget();
  const sent: { requestId: number; payload: unknown }[] = [];
  let channel: WebUIChannel | undefined;
  const port = createWebUIPort(document, () => channel, options);
  return { document, port, sent,
    ready() { channel = { sendMessage: (name, data) => { expect(name).toBe('derpbird.request'); sent.push(data as typeof sent[number]); } }; document.dispatchEvent(new Event('WebUILoaded')); },
    message(name: string, data: unknown) { document.dispatchEvent(new CustomEvent('WebUIMessage', { detail: { name, data } })); },
  };
}
test('style requests use the document channel and preserve save conflicts', async () => {
  const f = setup(); f.ready();
  const pending = f.port.styles.list();
  expect(f.sent[0].payload).toEqual({ type: 'styles.list' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { revision: 7, items: [] } });
  const snapshot = await pending;
  const save = f.port.styles.replace(snapshot);
  expect(f.sent[1].payload).toEqual({ type: 'styles.replace', revision: 7, items: [] });
  f.message('derpbird.response', { requestId: 2, ok: false, error: 'Styles changed in another window; reload before saving' });
  await expect(save).rejects.toThrow('Styles changed');
  expect(snapshot.revision).toBe(7);
  f.port.close();
});
test('waits for the document WebUI capability without polling or duplicating sends', async () => {
  const f = setup(); const result = f.port.snapshot();
  expect(f.sent).toHaveLength(0);
  f.ready(); f.ready(); expect(f.sent).toHaveLength(1);
  expect(f.sent[0]!.payload).toEqual({ type: 'snapshot' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { revision: 1 } });
  expect(await result).toEqual({ revision: 1 });
  f.port.close();
});
test('correlates out-of-order native replies', async () => {
  const f = setup(); f.ready();
  const first = f.port.snapshot(); const second = f.port.snapshot();
  f.message('derpbird.response', { requestId: 2, ok: true, value: 'second' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: 'first' });
  expect(await first).toBe('first'); expect(await second).toBe('second'); f.port.close();
});
test('propagates native command errors', async () => {
  const f = setup(); f.ready();
  const result = f.port.request({ type: 'tab.close', tabId: 'missing' });
  f.message('derpbird.response', { requestId: 1, ok: false, error: 'Unknown tab' });
  await expect(result).rejects.toThrow('Unknown tab'); f.port.close();
});
test('subscribers receive events and unsubscribe independently', () => {
  const f = setup(); const values: unknown[] = [];
  const unsubscribe = f.port.subscribe(value => values.push(value));
  f.message('derpbird.snapshot', 1); unsubscribe(); f.message('derpbird.snapshot', 2);
  expect(values).toEqual([1]); f.port.close();
});
test('close rejects pending work and revokes event listeners', async () => {
  const f = setup(); const result = f.port.snapshot();
  f.port.close(); f.ready(); expect(f.sent).toHaveLength(0);
  await expect(result).rejects.toThrow('closed');
  await expect(f.port.snapshot()).rejects.toThrow('closed');
  expect(() => f.port.subscribe(() => {})).toThrow('closed');
});
test('bounds requests and expires missing native replies', async () => {
  const f = setup({ timeoutMs: 10, maxPending: 1 });
  const result = f.port.snapshot();
  await expect(f.port.snapshot()).rejects.toThrow('Too many');
  await expect(result).rejects.toThrow('timed out'); f.port.close();
});
test('ignores malformed and unsolicited replies', async () => {
  const f = setup(); f.ready(); const result = f.port.snapshot();
  f.message('derpbird.response', { requestId: 100, ok: true });
  f.message('derpbird.response', { requestId: 1, ok: 'true' });
  f.message('unknown', { requestId: 1, ok: true });
  f.message('derpbird.response', { requestId: 1, ok: true, value: 7 });
  expect(await result).toBe(7); f.port.close();
});

test('credential management preserves i64 revisions and only lists metadata', async () => {
  const f = setup(); f.ready();
  const entry = { id: 'entry-1', origin: 'https://example.com', username: 'alice', revision: '9007199254740993' };
  const listing = f.port.credentials.list();
  expect(f.sent[0].payload).toEqual({ type: 'credentials.list' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { items: [entry] } });
  expect(await listing).toEqual([entry]);
  const removal = f.port.credentials.remove(entry);
  expect(f.sent[1].payload).toEqual({ type: 'credentials.remove', id: entry.id, origin: entry.origin, revision: entry.revision });
  f.message('derpbird.response', { requestId: 2, ok: false, error: 'Credential changed' });
  await expect(removal).rejects.toThrow('Credential changed');
  const save = f.port.credentials.save({ id: '', revision: '0', origin: entry.origin, username: 'alice', password: 'fixture-only' });
  f.message('derpbird.response', { requestId: 3, ok: true, value: entry });
  expect(await save).toEqual(entry);
  await expect(f.port.credentials.save({ ...entry, password: 'x'.repeat(65537) })).rejects.toThrow();
  expect(f.sent).toHaveLength(3);
  f.port.close();
});

test('reveal sends only credential identity and validates the separate secret response', async () => {
  const f = setup(); f.ready();
  const entry = { id: 'one', origin: 'https://example.com', username: 'alice', revision: '9007199254740993' };
  const shown = f.port.credentials.reveal(entry);
  expect(f.sent[0].payload).toEqual({ type: 'credentials.reveal', id: entry.id, origin: entry.origin, revision: entry.revision });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { password: 'fixture' } });
  expect(await shown).toBe('fixture');
  const invalid = f.port.credentials.reveal(entry);
  f.message('derpbird.response', { requestId: 2, ok: true, value: { password: 'x'.repeat(65537) } });
  await expect(invalid).rejects.toThrow(); f.port.close();
});

test('copy uses native clipboard route and never resolves a secret value', async () => {
  const f = setup(); f.ready();
  const entry = { id: 'one', origin: 'https://example.com', username: 'alice', revision: '9' };
  const copied = f.port.credentials.copy(entry);
  expect(f.sent[0].payload).toEqual({ type: 'credentials.copy', id: 'one', origin: entry.origin, revision: '9' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: null });
  expect(await copied).toBeUndefined(); f.port.close();
});

test('fill submits identity only and returns no secret to the shell', async () => {
  const f = setup(); f.ready();
  const entry = { id: 'one', origin: 'https://example.com', username: 'alice', revision: '9' };
  const filled = f.port.credentials.fill!(entry);
  expect(f.sent[0].payload).toEqual({ type: 'credentials.fill', id: 'one', origin: entry.origin, revision: '9' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: null });
  expect(await filled).toBeUndefined(); f.port.close();
});

test('capture exposes only proposal metadata and confirms using token plus CAS identity', async () => {
  const f = setup(); f.ready();
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: 'https://example.com', username: 'alice' };
  const pending = f.port.credentials.capture!.read();
  expect(f.sent[0].payload).toEqual({ type: 'credentials.capture' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: proposal });
  expect(await pending).toEqual(proposal);
  const entry = { id: 'one', origin: proposal.origin, username: proposal.username, revision: '9' };
  const saving = f.port.credentials.capture!.save(proposal.token, entry);
  expect(f.sent[1].payload).toEqual({ type: 'credentials.capture-save', token: proposal.token, id: 'one', revision: '9' });
  f.message('derpbird.response', { requestId: 2, ok: true, value: { ...entry, revision: '10' } });
  expect((await saving).revision).toBe('10');
  const invalid = f.port.credentials.capture!.read();
  f.message('derpbird.response', { requestId: 3, ok: true, value: { ...proposal, password: 'must-not-reach-ui' } });
  await expect(invalid).rejects.toThrow(); f.port.close();
});

test('save exceptions use proposal authority and exact origins', async () => {
  const f = setup(); f.ready();
  const token = '00000000-0000-4000-8000-000000000001';
  const blocking = f.port.credentials.exceptions!.never(token);
  expect(f.sent[0].payload).toEqual({ type: 'credentials.capture-never', token });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { origins: ['https://example.com'] } });
  expect(await blocking).toEqual(['https://example.com']);
  const allowing = f.port.credentials.exceptions!.allow('https://example.com');
  expect(f.sent[1].payload).toEqual({ type: 'credentials.allow-origin', origin: 'https://example.com', id: '', revision: '0' });
  f.message('derpbird.response', { requestId: 2, ok: true, value: { origins: [] } });
  expect(await allowing).toEqual([]);
  await expect(f.port.credentials.exceptions!.allow('https://example.com/path')).rejects.toThrow();
  const listing = f.port.credentials.exceptions!.list();
  f.message('derpbird.response', { requestId: 3, ok: true, value: { origins: ['https://example.com', 'https://example.com'] } });
  await expect(listing).rejects.toThrow();
  f.port.close();
});


test('style matching diagnostics use native status RPC and reject malformed replies', async () => {
  const f = setup(); f.ready();
  try {
    const pending = f.port.styles.status!();
    expect(f.sent[0].payload).toEqual({ type: 'styles.status' });
    const value = { revision: 7, url: 'https://example.com/', evaluated: true, skippedConditions: 1, styleIds: ['one'] };
    f.message('derpbird.response', { requestId: 1, ok: true, value });
    expect(await pending).toEqual(value);
    const invalid = f.port.styles.status!();
    f.message('derpbird.response', { requestId: 2, ok: true, value: { ...value, skippedConditions: -1 } });
    await expect(invalid).rejects.toThrow('Invalid user style state');
  } finally { f.port.close(); }
});


test('source cancellation stops the matching native request and ignores its late reply', async () => {
  const f = setup(); f.ready();
  const abort = new AbortController();
  const first = f.port.styles.fetchSource!('https://example.org/theme.css', abort.signal);
  expect(f.sent[0].payload).toEqual({ type: 'styles.fetch', url: 'https://example.org/theme.css', downloadToken: '1' });
  abort.abort();
  await expect(first).rejects.toThrow('cancelled');
  expect(f.sent[1].payload).toEqual({ type: 'sources.cancel', downloadToken: '1' });
  const second = f.port.scripts.fetchSource!('https://example.org/code.js');
  f.message('derpbird.response', { requestId: 1, ok: true, value: { url: 'https://example.org/old', source: 'old' } });
  f.message('derpbird.response', { requestId: 3, ok: true, value: { url: 'https://example.org/code.js', source: 'current' } });
  expect((await second).source).toBe('current');
  f.port.close();
});
test('cancelled queued sources are never dispatched when native channel arrives', async () => {
  const f = setup();
  const abort = new AbortController();
  const request = f.port.styles.fetchSource!('https://example.org/theme.css', abort.signal);
  abort.abort();
  await expect(request).rejects.toThrow('cancelled');
  f.ready(); expect(f.sent).toHaveLength(0);
  await expect(f.port.scripts.fetchSource!('https://example.org/code.js', abort.signal)).rejects.toThrow('cancelled');
  expect(f.sent).toHaveLength(0); f.port.close();
});

test('source transport is cancelled on timeout and connection close without an explicit signal', async () => {
  for (const reason of ['timeout', 'close']) {
    const f = setup({ timeoutMs: 10 }); f.ready();
    const request = f.port.styles.fetchSource!('https://example.org/theme.css');
    if (reason === 'close') f.port.close();
    await expect(request).rejects.toThrow(reason === 'close' ? 'closed' : 'timed out');
    expect(f.sent[1].payload).toEqual({ type: 'sources.cancel', downloadToken: '1' });
    f.port.close();
    expect(f.sent).toHaveLength(2);
  }
});
test('settled source requests detach their abort listener', async () => {
  const f = setup(); f.ready(); const abort = new AbortController();
  const request = f.port.scripts.fetchSource!('https://example.org/code.js', abort.signal);
  f.message('derpbird.response', { requestId: 1, ok: true, value: { url: 'https://example.org/code.js', source: '' } });
  await request; abort.abort(); f.port.close();
  expect(f.sent).toHaveLength(1);
});

test('native source lifecycle errors remain aborts without masking real download failures', async () => {
  for (const [message, name] of [['Source download cancelled', 'AbortError'], ['Source editor document expired', 'AbortError'], ['Source download failed', 'Error']] as const) {
    const f = setup(); f.ready();
    const pending = f.port.scripts.fetchSource!('https://example.org/code.js').catch(error => error);
    f.message('derpbird.response', { requestId: 1, ok: false, error: message });
    const error = await pending;
    expect(error.name).toBe(name);
    expect(error.message).toBe(message);
    f.port.close();
  }
});

test('import uses native profile and file-picker operations without sending CSV contents', async () => {
  const f = setup(); f.ready();
  const status = f.port.importer.status();
  expect(f.sent[0]!.payload).toEqual({ type: 'import.status' });
  f.message('derpbird.response', { requestId: 1, ok: true, value: { welcome: true, profiles: [{ id: '/fixture/Default', name: 'Fixture' }] } });
  expect((await status).welcome).toBe(true);
  const passwords = f.port.importer.passwords();
  expect(f.sent[1]!.payload).toEqual({ type: 'import.passwords' });
  f.message('derpbird.response', { requestId: 2, ok: true, value: { cancelled: true } });
  expect(await passwords).toEqual({ cancelled: true });
  const imported = f.port.importer.chrome({ profile: '/fixture/Default', bookmarks: true, history: false, tabs: true });
  expect(f.sent[2]!.payload).toEqual({ type: 'import.chrome', profile: '/fixture/Default', bookmarks: true, history: false, tabs: true });
  f.message('derpbird.response', { requestId: 3, ok: true, value: { bookmarks: 1, tabs: 2, skipped: 0, warnings: [] } });
  expect((await imported).tabs).toBe(2);
  const dismiss = f.port.importer.dismiss();
  f.message('derpbird.response', { requestId: 4, ok: true, value: null }); await dismiss;
  f.port.close();
});
