import { generatePassword } from './password-generator';
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import { validateCredentialDraft, type CapturedCredential, type Credential, type CredentialDraft, type CredentialPort } from './credential-protocol';
export interface CredentialModel {
  readonly items: readonly Credential[] | null;
  readonly draft: CredentialDraft | null;
  readonly passwordEdited: boolean;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly confirmingRemoval: boolean;
  readonly query: string;
  readonly revealed: string | null;
  readonly copied: boolean;
  readonly filled: boolean;
  readonly proposal: CapturedCredential | null;
  readonly exceptions: readonly string[];
}
export function createCredentialController(port: CredentialPort, revealMs = 30_000) {
  let state: CredentialModel = { items: null, draft: null, passwordEdited: false, dirty: false, busy: false, error: null, confirmingRemoval: false, query: '', revealed: null, copied: false, filled: false, proposal: null, exceptions: [] };
  const owner = modelOwner(state);
  let disposed = false;
  const patch = (change: Partial<CredentialModel>) => { if (!disposed) { state = { ...state, ...change }; owner.patch(change); } };
  let revealGeneration = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { ++revealGeneration; clearTimeout(hideTimer); hideTimer = undefined; patch({ revealed: null, copied: false, filled: false }); };
  const accept = (item?: Credential) => { hide(); patch({ draft: item ? { ...item, password: '' } : null, passwordEdited: false, dirty: false, confirmingRemoval: false, error: null }); };
  const canLeave = () => {
    if (disposed || state.busy) return false;
    if (state.proposal) { patch({ error: 'Save or dismiss the login prompt first.' }); return false; }
    if (state.dirty) { patch({ error: 'Save or discard your changes first.' }); return false; }
    return true;
  };
  const run = (work: () => Promise<void>) => {
    if (disposed || state.busy) return;
    patch({ busy: true, error: null });
    owner.run(['credentials'], Effect.tryPromise({ try: async () => { try { await work(); } finally { patch({ busy: false }); } }, catch: error => error })
      .pipe(Effect.catch(error => Effect.sync(() => patch({ error: error instanceof Error ? error.message : 'Operation failed.' })))), 'queue');
  };
  return {
    source: owner.source, state: () => state, canLeave, hide,
    capture() {
      if (!port.capture || !state.items || !canLeave()) return;
      hide();
      run(async () => {
        const proposal = await port.capture!.read();
        if (disposed) { await port.capture!.cancel(proposal.token).catch(() => {}); return; }
        patch({ proposal, confirmingRemoval: false });
      });
    },
    neverCapture() {
      if (!port.exceptions || !state.proposal || state.busy) return;
      const proposal = state.proposal;
      run(async () => { const exceptions = await port.exceptions!.never(proposal.token); patch({ exceptions, proposal: null }); });
    },
    allowOrigin(origin: string) {
      if (!port.exceptions || !state.exceptions.includes(origin) || !canLeave()) return;
      run(async () => { patch({ exceptions: await port.exceptions!.allow(origin) }); });
    },
    discardCapture() {
      if (!port.capture || !state.proposal || state.busy) return;
      const proposal = state.proposal;
      run(async () => { patch({ proposal: null }); await port.capture!.cancel(proposal.token); });
    },
    saveCapture(targetId: string | null) {
      if (!port.capture || !state.proposal || !state.items || state.busy) return;
      const proposal = state.proposal;
      const target = targetId === null ? null : state.items?.find(item => item.id === targetId);
      if (target === undefined || (target && (target.origin !== proposal.origin || target.username !== proposal.username))) return;
      run(async () => {
        // Native confirmation consumes the proposal, including on failure.
        patch({ proposal: null });
        const saved = await port.capture!.save(proposal.token, target);
        patch({ items: [...(state.items ?? []).filter(item => item.id !== saved.id), saved].sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)) });
        accept(saved);
      });
    },
    fill() {
      if (!port.fill || !state.draft?.id || !canLeave()) return;
      const { password: _, ...entry } = state.draft;
      hide();
      run(async () => {
        await port.fill!(entry);
        if (!disposed && state.draft?.id === entry.id) patch({ filled: true });
      });
    },
    copy() {
      if (!state.draft?.id || !canLeave()) return;
      const { password: _, ...entry } = state.draft;
      hide();
      const generation = revealGeneration;
      run(async () => {
        await port.copy(entry);
        if (!disposed && generation === revealGeneration && state.draft?.id === entry.id) {
          patch({ copied: true });
          hideTimer = setTimeout(hide, 30_000);
        }
      });
    },
    reveal() {
      if (!state.draft?.id || !canLeave()) return;
      const { password: _, ...entry } = state.draft;
      hide();
      const generation = revealGeneration;
      run(async () => {
        const password = await port.reveal(entry);
        if (disposed || generation !== revealGeneration || state.draft?.id !== entry.id || state.draft.revision !== entry.revision) return;
        patch({ revealed: password });
        hideTimer = setTimeout(hide, revealMs);
      });
    },
    load(proposal?: CapturedCredential) {
      if (disposed || state.busy) return;
      // Refreshing metadata must not discard a pending form proposal. In
      // particular, a failed initial read needs to be retryable in this dialog.
      if (state.dirty || (proposal && state.proposal)) { canLeave(); return; }
      hide();
      // Own the token before starting asynchronous work: close() must revoke it
      // even if the metadata read fails or the queued effect never starts.
      if (proposal && port.capture) patch({ proposal });
      run(async () => {
        const [items, exceptions] = await Promise.all([port.list(), port.exceptions?.list() ?? []]);
        if (disposed) return;
        patch({ items, exceptions });
        accept(items.find(item => item.id === state.draft?.id) ?? items[0]);
      });
    },
    select(id: string) { if (canLeave()) accept(state.items?.find(item => item.id === id)); },
    create() { if (state.items && canLeave()) { accept(); patch({ draft: { id: '', origin: '', username: '', password: '', revision: '0' }, dirty: true }); } },
    change(change: Partial<Pick<CredentialDraft, 'origin' | 'username' | 'password'>>) {
      if (disposed || state.busy || !state.draft || state.proposal) return;
      if (state.draft.id && change.origin !== undefined) return;
      hide();
      patch({ draft: { ...state.draft, ...change }, dirty: true, passwordEdited: state.passwordEdited || change.password !== undefined, error: null, confirmingRemoval: false });
    },
    generate() {
      if (disposed || state.busy || !state.draft || state.proposal) return;
      try {
        const password = generatePassword();
        hide();
        patch({ draft: { ...state.draft, password }, dirty: true, passwordEdited: true, error: null, confirmingRemoval: false });
      } catch { patch({ error: 'Could not generate a password. Enter one or try again.' }); }
    },
    search(query: string) { patch({ query }); },
    discard() { if (!state.busy && !state.proposal) accept(state.items?.find(item => item.id === state.draft?.id)); },
    save() {
      const draft = state.draft;
      if (!draft || !state.dirty || state.proposal) return;
      run(async () => {
        if (!state.passwordEdited) throw new Error('Enter a password to save this login.');
        let url: URL;
        try { url = new URL(draft.origin); } catch { throw new Error('Enter an https:// or http:// site address.'); }
        if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Enter a site address without credentials.');
        const saved = await port.save(validateCredentialDraft({ ...draft, origin: url.origin }));
        patch({ items: [...(state.items ?? []).filter(item => item.id !== saved.id), saved].sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)) });
        accept(saved);
      });
    },
    requestRemove() { if (state.draft?.id && canLeave()) { hide(); patch({ confirmingRemoval: true }); } },
    cancelRemove() { if (!state.busy) patch({ confirmingRemoval: false }); },
    remove() {
      const draft = state.draft;
      if (!draft?.id || !state.confirmingRemoval || !canLeave()) return;
      run(async () => { const { password: _, ...entry } = draft; await port.remove(entry); patch({ items: (state.items ?? []).filter(item => item.id !== draft.id) }); accept(); });
    },
    async close() { const proposal = state.proposal; hide(); patch({ proposal: null, draft: null, items: null, dirty: false, passwordEdited: false }); disposed = true; if (proposal && port.capture) await port.capture.cancel(proposal.token).catch(() => {}); await Effect.runPromise(owner.close()); },
  };
}
export type CredentialController = ReturnType<typeof createCredentialController>;
