import { ShellPopover } from './Overlay';
import { Effect } from 'effect';
import { modelOwner, mount, view, list } from 'effectweb';
import Settings2 from '@effectweb/lucide/icons/settings-2';
import RotateCw from '@effectweb/lucide/icons/rotate-cw';
import type { PageSources, PageSourcesPort, SourceKind } from '../browser/page-sources';

export function openPageSources(host: HTMLElement, port: PageSourcesPort, kind: SourceKind, onClosed: () => void, onChange: (page: PageSources) => void, manage: () => void, reload: () => void) {
  type Model = { page?: PageSources; busy: boolean; error: string; reload: boolean };
  const owner = modelOwner<Model>({ busy: true, error: '', reload: false });
  let state: Model = { busy: true, error: '', reload: false }, disposed = false;
  const patch = (p: Partial<Model>) => { if (!disposed) { state = { ...state, ...p }; owner.patch(p); } };
  const run = (work: () => Promise<PageSources>, finished?: () => void) => {
    patch({ busy: true, error: '' });
    owner.run(['page-sources'], Effect.tryPromise({ try: work, catch: (error) => error instanceof Error ? error.message : String(error) }).pipe(
      Effect.tap(page => Effect.sync(() => { if (!disposed) { patch({ page }); onChange(page); } })),
      Effect.catch(error => Effect.sync(() => patch({ error }))),
      Effect.ensuring(Effect.sync(() => { patch({busy: false}); if (!disposed) finished?.(); })),
    ), 'queue');
  };
  const close = () => { dispose(); onClosed(); };
  const refresh = () => run(() => port.page());
  const render = view<Model>(m => <ShellPopover onDismiss={close} trigger={() => document.querySelector('button[aria-label="Menu"]')} class={`style-manager page-sources-popup ${kind}`} aria-label={kind === 'styles' ? 'Styles on this page' : 'Scripts on this page'}>
    <header><h2 title={m.page?.url}>{kind === 'styles' ? 'Styles' : 'Scripts'} <span>{m.page ? `on ${(() => { try { return new URL(m.page.url).host || m.page.url; } catch { return m.page.url; } })()}` : 'Loading…'}</span></h2></header>
    <div class="page-sources-list">
      {list(m.page?.[kind] ?? [], item => item.id, item => <label class="page-source-row"><span><strong>{item.name}</strong>{item.manual ? <small>Run from context menu</small> : null}</span><input type="checkbox" role="switch" data-source-id={item.id} aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`} checked={item.enabled} aria-disabled={m.busy} onKeyDown={event => { if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); if (!m.busy) event.currentTarget.click(); } }} onClick={event => { if (m.busy) event.preventDefault(); }} onChange={e => { const enabled = e.currentTarget.checked, focused = document.activeElement === e.currentTarget; run(async () => { const page = await port.toggle(m.page!, kind, item.id, enabled); if (kind === 'scripts') patch({ reload: true }); return page; }, () => { if (!disposed && focused && (!document.activeElement || document.activeElement === document.body)) Array.from(host.querySelectorAll<HTMLInputElement>('input[data-source-id]')).find(input => input.dataset.sourceId === item.id)?.focus({ preventScroll: true }); }); }}/></label>)}
      {!m.busy && !m.page?.[kind].length ? <div class="page-sources-empty">No {kind} match this page.</div> : null}
      {m.error ? <div class="source-notice" role="alert">{m.error}<button onClick={refresh}>Refresh</button></div> : null}
    </div>
    <div class="page-sources-reload-slot" data-visible={m.reload} aria-hidden={!m.reload}><div class="page-sources-reload-clip"><div class="page-sources-reload" role="status"><button disabled={m.busy || !m.reload} onClick={() => { patch({ reload: false }); reload(); }}><RotateCw size={14}/>Reload page</button></div></div></div>
    <footer><button disabled={m.busy} onClick={() => { close(); manage(); }}><Settings2 size={15}/>Manage {kind}</button></footer>
  </ShellPopover>);
  const mounted = mount(host, render, owner.source);
  const dispose = () => { if (disposed) return; disposed = true; mounted.dispose(); void Effect.runPromise(owner.close()); };
  refresh();
  return { dispose, close };
}
