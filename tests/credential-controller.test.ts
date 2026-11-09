import { expect, test } from 'bun:test';
import { createCredentialController, type CredentialController } from '../src/browser/credential-controller';
import type { CredentialDraft } from '../src/browser/credential-protocol';
const entry = { id: 'one', origin: 'https://example.com', username: 'alice', revision: '1' };
async function settled(c: CredentialController) {
  const deadline = Date.now() + 3000;
  while (c.state().busy && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
  expect(c.state().busy).toBe(false);
}
test('new entry normalizes origin, clears password after save, and confirms removal', async () => {
  let saved: CredentialDraft | undefined, removed = 0;
  const c = createCredentialController({ copy: async () => {}, reveal: async () => 'fixture', list: async () => [], save: async draft => { saved = draft; return { ...entry }; }, remove: async () => { removed++; } });
  c.load(); await settled(c); c.create();
  c.change({ origin: 'https://example.com/login', username: 'alice', password: 'fixture-only' });
  c.save(); c.save(); await settled(c);
  expect(saved?.origin).toBe(entry.origin);
  expect(c.state().draft?.password).toBe('');
  expect(c.state().items).toEqual([entry]);
  c.remove(); expect(removed).toBe(0);
  c.requestRemove(); c.cancelRemove(); c.remove(); expect(removed).toBe(0);
  c.requestRemove(); c.remove(); await settled(c);
  expect(removed).toBe(1); expect(c.state().items).toEqual([]);
  await c.close(); expect(c.state().draft).toBeNull();
});
test('conflict keeps draft, blocks accidental password clearing and dirty navigation', async () => {
  let writes = 0;
  const c = createCredentialController({ copy: async () => {}, reveal: async () => 'fixture', list: async () => [entry], save: async () => { writes++; throw new Error('Credential changed'); }, remove: async () => {} });
  c.load(); await settled(c); c.change({ username: 'bob' }); c.save(); await settled(c);
  expect(writes).toBe(0); expect(c.state().error).toContain('Enter a password');
  c.change({ password: 'replacement' }); c.save(); await settled(c);
  expect(c.state().error).toBe('Credential changed'); expect(c.state().dirty).toBe(true);
  c.create(); expect(c.state().draft?.id).toBe('one');
  c.change({ origin: 'https://attacker.example' }); expect(c.state().draft?.origin).toBe(entry.origin);
  c.discard(); expect(c.state().draft?.password).toBe(''); expect(c.state().draft?.username).toBe('alice');
  await c.close();
});
test('closing drops a pending secret draft and late metadata response', async () => {
  let resolve: ((items: typeof entry[]) => void) | undefined;
  const c = createCredentialController({ copy: async () => {}, reveal: async () => 'fixture', list: () => new Promise(r => { resolve = r; }), save: async () => entry, remove: async () => {} });
  c.load();
  while (!resolve) await new Promise(r => setTimeout(r, 5));
  await c.close(); resolve([entry]);
  await new Promise(r => setTimeout(r, 10));
  expect(c.state().items).toBeNull(); expect(c.state().draft).toBeNull();
});
test('closing during deletion ignores the late completion without accessing cleared items', async () => {
  let finish: (() => void) | undefined;
  const c = createCredentialController({ copy: async () => {}, reveal: async () => 'fixture', list: async () => [entry], save: async () => entry, remove: () => new Promise(resolve => { finish = resolve; }) });
  c.load(); await settled(c); c.requestRemove(); c.remove();
  while (!finish) await new Promise(r => setTimeout(r, 5));
  await c.close(); finish();
  await new Promise(r => setTimeout(r, 10));
  expect(c.state().items).toBeNull(); expect(c.state().draft).toBeNull();
});

test('explicit reveal expires and changing selection removes the displayed secret', async () => {
  let reads = 0;
  const second = { ...entry, id: 'two' };
  const c = createCredentialController({ copy: async () => {}, list: async () => [entry, second], save: async () => entry, remove: async () => {}, reveal: async value => { reads++; expect(value).toEqual(entry); return 'fixture'; } }, 40);
  c.load(); await settled(c); expect(reads).toBe(0);
  c.reveal(); await settled(c); expect(c.state().revealed).toBe('fixture');
  await new Promise(r => setTimeout(r, 60)); expect(c.state().revealed).toBeNull();
  c.reveal(); await settled(c); c.select('two'); expect(c.state().revealed).toBeNull();
  await c.close();
});
test('hiding while reveal is pending invalidates the response', async () => {
  let finish: ((password: string) => void) | undefined;
  const c = createCredentialController({ copy: async () => {}, list: async () => [entry], save: async () => entry, remove: async () => {}, reveal: () => new Promise(r => { finish = r; }) });
  c.load(); await settled(c); c.reveal();
  while (!finish) await new Promise(r => setTimeout(r, 5));
  c.hide(); finish('must-stay-hidden'); await settled(c);
  expect(c.state().revealed).toBeNull(); await c.close();
});
test('generation edits only the draft, marks password changed and does not persist without save', async () => {
  let writes = 0;
  const c = createCredentialController({ copy: async () => {}, list: async () => [entry], reveal: async () => 'fixture', save: async () => { writes++; return entry; }, remove: async () => {} });
  c.load(); await settled(c); c.reveal(); await settled(c);
  c.generate();
  expect(c.state().draft?.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
  expect(c.state().draft?.origin).toBe(entry.origin);
  expect(c.state().dirty).toBe(true); expect(c.state().passwordEdited).toBe(true);
  expect(c.state().revealed).toBeNull(); expect(writes).toBe(0);
  c.discard(); expect(c.state().draft?.password).toBe('');
  await c.close();
});

test('copy sends only saved identity and reports failure without exposing a secret', async () => {
  let calls = 0;
  const c = createCredentialController({ list: async () => [entry], save: async () => entry, remove: async () => {}, reveal: async () => 'fixture', copy: async value => { expect(value).toEqual(entry); if (++calls > 1) throw Error('Clipboard changed'); } });
  c.load(); await settled(c); c.copy(); await settled(c);
  expect(c.state().copied).toBe(true); expect(c.state().revealed).toBeNull();
  c.copy(); await settled(c); expect(c.state().copied).toBe(false); expect(c.state().error).toBe('Clipboard changed');
  c.change({ username: 'dirty' }); c.copy(); expect(calls).toBe(2);
  await c.close();
});
test('fill sends only saved metadata, blocks dirty and duplicate work, and reports failure', async () => {
  let calls = 0;
  let reject = false;
  const c = createCredentialController({
    list: async () => [entry], copy: async () => {}, reveal: async () => 'fixture',
    save: async () => entry, remove: async () => {},
    fill: async selected => { expect(selected).toEqual(entry); calls++; if (reject) throw new Error('Page changed'); },
  });
  c.load(); await settled(c);
  c.fill(); c.fill(); await settled(c);
  expect(calls).toBe(1); expect(c.state().filled).toBe(true); expect(c.state().revealed).toBeNull();
  c.change({ username: 'dirty' }); c.fill(); expect(calls).toBe(1);
  c.discard(); reject = true; c.fill(); await settled(c);
  expect(calls).toBe(2); expect(c.state().filled).toBe(false); expect(c.state().error).toBe('Page changed');
  await c.close();
});

test('captured form requires explicit new/update confirmation and never uses draft save', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  const targets: unknown[] = [];
  const c = createCredentialController({
    list: async () => [entry, { ...entry, id: 'foreign', origin: 'https://other.example' }],
    copy: async () => {}, reveal: async () => '', remove: async () => {},
    save: async () => { throw new Error('No secret draft save'); },
    capture: { read: async () => proposal, cancel: async () => {}, save: async (token, target) => { expect(token).toBe(proposal.token); targets.push(target); return { ...entry, revision: '2' }; } },
  });
  c.load(); await settled(c); c.capture(); await settled(c);
  expect(targets).toEqual([]); expect(c.state().proposal).toEqual(proposal); expect(c.canLeave()).toBe(false);
  c.saveCapture('foreign'); expect(targets).toEqual([]);
  c.change({ password: 'must-not-edit' }); expect(c.state().dirty).toBe(false);
  c.saveCapture(entry.id); c.saveCapture(null); await settled(c);
  expect(targets).toEqual([entry]); expect(c.state().proposal).toBeNull(); expect(c.state().draft?.revision).toBe('2');
  c.capture(); await settled(c); c.saveCapture(null); await settled(c);
  expect(targets[1]).toBeNull(); await c.close();
});

test('capture discard and late completion revoke native proposal without saving', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  let cancelled = 0;
  let resolve: ((value: typeof proposal) => void) | undefined;
  let delayed = false;
  const c = createCredentialController({
    list: async () => [entry], copy: async () => {}, reveal: async () => '', remove: async () => {}, save: async () => entry,
    capture: { read: async () => delayed ? new Promise(r => { resolve = r; }) : proposal, cancel: async token => { expect(token).toBe(proposal.token); cancelled++; }, save: async () => { throw new Error('Unexpected confirmation'); } },
  });
  c.load(); await settled(c); c.capture(); await settled(c); c.discardCapture(); await settled(c);
  expect(cancelled).toBe(1); expect(c.state().proposal).toBeNull();
  delayed = true; c.capture(); await new Promise(r => setTimeout(r, 10));
  const closing = c.close(); resolve!(proposal); await closing; await new Promise(r => setTimeout(r, 10));
  expect(cancelled).toBe(2); expect(c.state().proposal).toBeNull();
});

test('submitted proposal loads records without recapturing or writing and updates only on confirmation', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  let reads = 0, writes = 0, cancels = 0;
  const c = createCredentialController({ list: async () => [entry], copy: async () => {}, reveal: async () => '', remove: async () => {}, save: async () => { throw new Error('unexpected manual save'); }, capture: {
    read: async () => { reads++; return proposal; },
    save: async (token, target) => { expect(token).toBe(proposal.token); expect(target).toEqual(entry); writes++; return { ...entry, revision: '2' }; },
    cancel: async () => { cancels++; },
  } });
  c.load(proposal); await settled(c);
  expect(c.state().proposal).toEqual(proposal);
  expect(c.state().draft?.password).toBe('');
  expect(reads).toBe(0); expect(writes).toBe(0);
  c.saveCapture(entry.id); await settled(c);
  expect(writes).toBe(1); expect(c.state().proposal).toBeNull();
  await c.close(); expect(cancels).toBe(0);
});

test('submitted proposal survives a failed metadata load and supports retry without recapture', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  let fail = true, cancellations = 0, saves = 0;
  const c = createCredentialController({ list: async () => { if (fail) throw new Error('catalog unavailable'); return [entry]; }, copy: async () => {}, reveal: async () => '', remove: async () => {}, save: async () => entry,
    capture: { read: async () => { throw new Error('unexpected recapture'); }, cancel: async () => { cancellations++; }, save: async () => { saves++; return entry; } },
  });
  try {
    c.load(proposal); await settled(c);
    expect(c.state().error).toBe('catalog unavailable');
    expect(c.state().proposal).toEqual(proposal);
    c.saveCapture(null); await settled(c);
    expect(saves).toBe(0);
    fail = false; c.load(); await settled(c);
    expect(c.state().items).toEqual([entry]);
    expect(c.state().proposal).toEqual(proposal);
    expect(c.state().error).toBeNull();
  } finally { await c.close(); }
  expect(cancellations).toBe(1);
});

test('closing before submitted-proposal metadata resolves cancels its token exactly once', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  let resolve!: (items: typeof entry[]) => void;
  const pending = new Promise<typeof entry[]>(r => { resolve = r; });
  const cancelled: string[] = [];
  const c = createCredentialController({ list: () => pending, copy: async () => {}, reveal: async () => '', remove: async () => {}, save: async () => entry,
    capture: { read: async () => proposal, cancel: async token => { cancelled.push(token); }, save: async () => entry },
  });
  c.load(proposal);
  await c.close();
  resolve([entry]);
  await new Promise(r => setTimeout(r, 10));
  expect(cancelled).toEqual([proposal.token]);
  expect(c.state().proposal).toBeNull();
  expect(c.state().items).toBeNull();
});

test('never-save failure preserves proposal; successful rule can be removed without changing credentials', async () => {
  const proposal = { token: '00000000-0000-4000-8000-000000000001', origin: entry.origin, username: entry.username };
  let fail = true, blocked = 0, allowed = 0;
  const c = createCredentialController({ list: async () => [entry], copy: async () => {}, reveal: async () => '', remove: async () => {}, save: async () => { throw new Error('unexpected write'); },
    capture: { read: async () => proposal, save: async () => { throw new Error('unexpected save'); }, cancel: async () => {} },
    exceptions: { list: async () => [], never: async token => { expect(token).toBe(proposal.token); blocked++; if (fail) throw new Error('disk unavailable'); return [entry.origin]; }, allow: async origin => { expect(origin).toBe(entry.origin); allowed++; return []; } },
  });
  c.load(proposal); await settled(c);
  c.neverCapture(); await settled(c);
  expect(c.state().error).toBe('disk unavailable'); expect(c.state().proposal).toEqual(proposal);
  fail = false; c.neverCapture(); c.neverCapture(); await settled(c);
  expect(blocked).toBe(2); expect(c.state().proposal).toBeNull(); expect(c.state().exceptions).toEqual([entry.origin]);
  c.allowOrigin('https://other.example'); expect(allowed).toBe(0);
  c.allowOrigin(entry.origin); await settled(c);
  expect(allowed).toBe(1); expect(c.state().exceptions).toEqual([]); expect(c.state().items).toEqual([entry]);
  await c.close();
});
