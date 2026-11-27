import { Effect } from 'effect';
import { list, modelOwner, mount, view } from 'effectweb';
import type { WebUIPort } from '../browser/webui-port';
import './app-downloads.css';

import type { BrowserDownload } from '../browser/protocol';
import { downloadSize } from './collections/download-menu';
import FileText from '@effectweb/lucide/icons/file-text';
import X from '@effectweb/lucide/icons/x';
import './preferences-primitives.css';

type Download = Pick<BrowserDownload, 'id' | 'name' | 'received' | 'total' | 'status'>;

export async function mountAppDownloads(host: HTMLElement, port: WebUIPort) {
  const owner = modelOwner<{ rows: Download[] }>({ rows: [] });
  const timers = new Map<string, number>();
  const dismiss = (id: string) => port.devtoolsRequest({ type: 'downloads.dismiss', id });
  document.documentElement.classList.add('app-downloads-surface');
  const mounted = mount(host, view<{ rows: Download[] }>(state =>
    <section id="downloads-popover" class="app-downloads" aria-label="Downloads">{list(state.rows, row => row.id, row =>
      <article class="transfer-row"><span class="download-icon"><FileText size={20}/></span><div>
        <b title={row.name}>{row.name}</b>
        <small role="status">{row.status} · {downloadSize(row)}</small>
        <progress aria-label={row.name} max={row.total || 1} value={row.status === 'Finished' ? row.total || 1 : row.total ? row.received : undefined}/>
      </div><button type="button" aria-label={`Dismiss ${row.name}`} onClick={() => void dismiss(row.id)}><X size={16}/></button></article>)}</section>), owner.source);
  const unsubscribe = port.subscribe(snapshot => {
    if (!snapshot || typeof snapshot !== 'object' || !('rows' in snapshot) || !Array.isArray(snapshot.rows)) return;
    host.classList.add('preferences-theme');
    host.dataset.theme = 'theme' in snapshot && snapshot.theme === 'light' ? 'light' : 'dark';
    const rows = snapshot.rows as Download[];
    owner.patch({ rows });
    for (const [id, timer] of timers) {
      if (rows.some(row => row.id === id)) continue;
      clearTimeout(timer);
      timers.delete(id);
    }
    for (const row of rows) {
      if (row.status !== 'Downloading' && row.status !== 'Paused' && !timers.has(row.id))
        timers.set(row.id, window.setTimeout(() => void dismiss(row.id), 2500));
    }
  });
  await port.devtoolsRequest({ type: 'downloads.ready' });
  return () => {
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
    mounted.dispose();
    void Effect.runPromise(owner.close());
  };
}
