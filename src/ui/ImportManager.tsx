import { Effect } from 'effect';
import { mount, modelOwner, view } from 'effectweb';
import { Button } from './button';
import type { ImportPort, ImportReport, ImportStatus } from '../browser/import-protocol';
interface Model { status: ImportStatus | null; profile: string; bookmarks: boolean; history: boolean; tabs: boolean; busy: boolean; report: ImportReport | null; error: string | null }
export function openImportManager(host: HTMLElement, port: ImportPort, onClosed: () => void, welcome = false) {
  let state: Model = { status: null, profile: '', bookmarks: true, history: true, tabs: false, busy: false, report: null, error: null };
  const owner = modelOwner(state);
  let disposed = false;
  const patch = (change: Partial<Model>) => { if (!disposed) { state = { ...state, ...change }; owner.patch(change); } };
  const run = (work: () => Promise<void>) => {
    if (state.busy || disposed) return;
    patch({ busy: true, error: null });
    owner.run(['import'], Effect.tryPromise({ try: async () => { try { await work(); } finally { patch({ busy: false }); } }, catch: error => error })
      .pipe(Effect.catch(error => Effect.sync(() => patch({ error: error instanceof Error ? error.message : 'Import failed.' })))), 'queue');
  };
  const close = () => { if (state.busy) return; run(async () => { await port.dismiss(); dispose(); onClosed(); }); };
  const render = view<Model>(m => <section class="style-manager import-manager" role="dialog" aria-modal="true" aria-label="Import browser data" tabindex={-1}>
    <header><h2>{welcome ? 'Welcome to DerpBird' : 'Import browser data'}</h2><Button variant="ghost" disabled={m.busy} onClick={close}>{m.report ? 'Done' : welcome ? 'Not now' : 'Close'}</Button></header>
    <div class="import-body">
      <p>Bring your bookmarks, history and tabs from Chrome.</p>
      {m.status?.profiles.length ? <>
        <label>Chrome profile<select aria-label="Chrome profile" disabled={m.busy} value={m.profile} onChange={e => patch({ profile: e.currentTarget.value, report: null })}>
          {m.status.profiles.map(profile => <option value={profile.id}>{profile.name}</option>)}
        </select></label>
        <div class="import-options">
          <label><input type="checkbox" checked={m.bookmarks} disabled={m.busy} onChange={e => patch({ bookmarks: e.currentTarget.checked })}/>Bookmarks and folders</label>
          <label><input type="checkbox" checked={m.history} disabled={m.busy} onChange={e => patch({ history: e.currentTarget.checked })}/>Browsing history</label>
          <label><input type="checkbox" checked={m.tabs} disabled={m.busy} onChange={e => patch({ tabs: e.currentTarget.checked })}/>Open tabs from the saved session</label>
        </div>
        <p class="subtle">Close Chrome first to include its latest session. Existing bookmarks, history and passwords are kept.</p>
        <Button disabled={m.busy || !m.profile || !(m.bookmarks || m.history || m.tabs)} onClick={() => run(async () => {
          patch({ report: null }); const report = await port.chrome({ profile: state.profile, bookmarks: state.bookmarks, history: state.history, tabs: state.tabs }); patch({ report }); await port.dismiss();
        })}>Import selected data</Button>
      </> : m.status ? <p>No local Chrome profiles found.</p> : null}
      <section class="import-passwords"><h3>Passwords</h3><p>Choose a CSV exported from Google Password Manager. Logins are stored in your system keyring; existing site and username pairs are skipped.</p>
        <Button disabled={m.busy} onClick={() => run(async () => { patch({ report: null }); const report = await port.passwords(); if (!report.cancelled) { patch({ report }); await port.dismiss(); } })}>Choose password CSV…</Button>
        <p class="subtle">CSV contains readable passwords. Delete the exported file after importing.</p>
      </section>
      {m.busy ? <p role="status">Importing…</p> : null}
      {m.report ? <section class="import-result" role="status"><h3>Import finished</h3>
        {m.report.bookmarks !== undefined ? <p>{m.report.bookmarks} bookmarks imported</p> : null}
        {m.report.history !== undefined ? <p>{m.report.history} history entries imported</p> : null}
        {m.report.tabs !== undefined ? <p>{m.report.tabs} tabs opened</p> : null}
        {m.report.passwords !== undefined ? <p>{m.report.passwords} passwords imported</p> : null}
        {m.report.skipped ? <p>{m.report.skipped} duplicate or unsupported entries skipped</p> : null}
        {m.report.failed ? <p role="alert">{m.report.failed} passwords could not be saved. Unlock your keyring and retry; imported logins will be skipped.</p> : null}
        {m.report.warnings?.map(warning => <p role="alert">{warning}</p>)}
      </section> : null}
      {m.error ? <p role="alert">{m.error}</p> : null}
    </div>
  </section>);
  const mounted = mount(host, render, owner.source);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const nodes = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      const first = nodes[0], last = nodes.at(-1);
      if (!host.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  const dispose = () => { if (disposed) return; disposed = true; document.removeEventListener('keydown', onKey); mounted.dispose(); void Effect.runPromise(owner.close()); };
  run(async () => { const status = await port.status(); patch({ status, profile: status.profiles[0]?.id ?? '' }); });
  window.requestAnimationFrame(() => { if (!disposed) host.querySelector<HTMLElement>('[role=dialog]')?.focus(); });
  return { dispose };
}
