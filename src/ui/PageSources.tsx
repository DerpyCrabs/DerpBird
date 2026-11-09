import { ShellPopover } from './Overlay';
import { Effect } from 'effect';
import { modelOwner, mount, view } from 'effectweb';
import Settings2 from '@effectweb/lucide/icons/settings-2';
import RotateCw from '@effectweb/lucide/icons/rotate-cw';
import type { PageSources, PageSourcesPort, SourceKind } from '../browser/page-sources';

export function openPageSources(host: HTMLElement, port: PageSourcesPort, kind: SourceKind, onClosed: () => void, onChange: (page: PageSources) => void, manage: () => void, reload: () => void) {
  type Model = { page?: PageSources; busy: boolean; error: string; reload: boolean };
  const owner = modelOwner<Model>({ busy: true, error: '', reload: false });
  let state: Model = { busy: true, error: '', reload: false }, disposed = false;
  const patch = (p: Partial<Model>) => { if (!disposed) { state = { ...state, ...p }; owner.patch(p); } };
  const run = async (work: () => Promise<PageSources>) => {
    patch({ busy: true, error: '' });
    try { const page = await work(); if (!disposed) { patch({ page }); onChange(page); } }
    catch (error) { patch({ error: error instanceof Error ? error.message : String(error) }); }
    finally { patch({ busy: false }); }
  };
  const close = () => { dispose(); onClosed(); };
  const render = view<Model>(m => <ShellPopover onDismiss={close} trigger={() => document.querySelector(`button[aria-label="${kind === 'styles' ? 'Styles' : 'Scripts'} on this page"]`)} class={`style-manager page-sources-popup ${kind}`} aria-label={kind === 'styles' ? 'Styles on this page' : 'Scripts on this page'}>
    <header><h2 title={m.page?.url}>{kind === 'styles' ? 'Styles' : 'Scripts'} <span>{m.page ? `on ${(() => { try { return new URL(m.page.url).host || m.page.url; } catch { return m.page.url; } })()}` : 'Loading…'}</span></h2></header>
    <div class="page-sources-list">
      {m.page?.[kind].map(item => <label class="page-source-row"><span><strong>{item.name}</strong>{item.manual ? <small>Run from context menu</small> : null}</span><input type="checkbox" role="switch" aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`} checked={item.enabled} disabled={m.busy} onChange={e => { const enabled = e.currentTarget.checked; void run(async () => { const page = await port.toggle(m.page!, kind, item.id, enabled); if (kind === 'scripts') patch({ reload: true }); return page; }); }}/></label>)}
      {!m.busy && !m.page?.[kind].length ? <div class="page-sources-empty">No {kind} match this page.</div> : null}
      {m.error ? <div class="source-notice" role="alert">{m.error}<button onClick={() => void run(() => port.page())}>Refresh</button></div> : null}
    </div>
    {m.reload ? <div class="page-sources-reload" role="status"><button disabled={m.busy} onClick={() => { close(); reload(); }}><RotateCw size={14}/>Reload page</button></div> : null}
    <footer><button disabled={m.busy} onClick={() => { close(); manage(); }}><Settings2 size={15}/>Manage {kind}</button></footer>
  </ShellPopover>);
  const mounted = mount(host, render, owner.source);
  const dispose = () => { if (disposed) return; disposed = true; mounted.dispose(); void Effect.runPromise(owner.close()); };
  void run(() => port.page());
  return { dispose, close };
}
