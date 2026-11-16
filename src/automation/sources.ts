import { pathToFileURL } from 'node:url';
import { parseUserScript } from '../browser/user-scripts';
import { createStyleCompiler } from '../browser/style-compiler';
import { decodeDownloadedSource } from '../browser/source-files';
import { decodeScriptSnapshot, scriptExecutionNotice } from '../browser/script-protocol';
import type { AgentBrowser } from './browser';

export interface SourceOperation {
  action: 'list' | 'get' | 'save' | 'remove' | 'enable' | 'disable';
  id?: string;
  source?: string;
  name?: string;
  revision?: number;
  values?: Record<string, string | number>;
}

/** Reuses the same parsers, compilers, revision checks and install pipeline as the editors. */
export async function manageSource(browser: AgentBrowser, kind: 'scripts' | 'styles', args: SourceOperation) {
  const snapshot = await browser.currentShell({ type: `${kind}.list` });
  if (args.revision !== undefined && snapshot.revision !== args.revision) throw new Error('Sources changed; read the latest revision before editing');
  if (args.action === 'list') return { revision: snapshot.revision, items: snapshot.items.map(({ source, requiredSources, cachedResources, ...item }: any) => item) };
  const previous = snapshot.items.find((item: any) => item.id === args.id);
  if (args.action !== 'save' && !previous) throw new Error('Source ID not found');
  if (args.action === 'get') return { revision: snapshot.revision, item: previous };
  let items = [...snapshot.items];
  let id = args.id;
  if (args.action === 'save') {
    if (args.source === undefined) throw new Error('source is required');
    if (id && !previous) throw new Error('Source ID not found; omit id to create a new source');
    id ??= crypto.randomUUID().replaceAll('-', '');
    let item: any;
    if (kind === 'scripts') {
      const metadata = parseUserScript(args.source, previous?.sourceURL);
      item = { ...previous, id, source: args.source, name: args.name ?? metadata.name, enabled: previous?.enabled ?? true, fileAccessGranted: previous?.fileAccessGranted ?? false, metadata };
    } else {
      const compiler = createStyleCompiler(async (url, signal) => {
        const downloadToken = crypto.randomUUID().replaceAll('-', '');
        const cancel = () => { void browser.currentShell({ type: 'sources.cancel', downloadToken }).catch(() => {}); };
        signal?.addEventListener('abort', cancel, { once: true });
        try { return decodeDownloadedSource(await browser.currentShell({ type: 'styles.fetch', url, downloadToken })); }
        finally { signal?.removeEventListener('abort', cancel); }
      }, process.env.DERPBIRD_STYLE_WORKER ? pathToFileURL(process.env.DERPBIRD_STYLE_WORKER) : undefined);
      const compiled = await compiler.compile(args.source, args.values ?? previous?.usercss?.values ?? {}, { sourceURL: previous?.sourceBaseURL ?? previous?.sourceURL }).finally(() => compiler.close());
      item = { ...previous, id, source: args.source, name: args.name ?? compiled.metadata?.name ?? previous?.name ?? 'Agent style', enabled: previous?.enabled ?? true, sections: compiled.sections,
        ...(compiled.metadata ? { usercss: { values: compiled.values } } : {}), ...(compiled.imports ? { imports: compiled.imports } : {}) };
    }
    items = previous ? items.map(existing => existing.id === id ? item : existing) : [...items, item];
  } else if (args.action === 'remove') items = items.filter(item => item.id !== id);
  else items = items.map(item => item.id === id ? { ...item, enabled: args.action === 'enable' } : item);
  const result = await browser.currentShell({ type: `${kind}.replace`, revision: snapshot.revision, items });
  const saved = (kind === 'scripts' ? decodeScriptSnapshot(result).items : result.items).find((item: any) => item.id === id);
  return { revision: result.revision, id, ...(saved ? { name: saved.name, enabled: saved.enabled } : { removed: true }),
    ...(kind === 'scripts' && saved ? { notice: scriptExecutionNotice(saved), reloadRequired: true } : {}) };
}
