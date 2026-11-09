export type SourceKind = 'styles' | 'scripts';
export interface PageSource { readonly id: string; readonly name: string; readonly enabled: boolean; readonly manual?: boolean }
export interface PageSources { readonly tabId: string; readonly url: string; readonly styleRevision: number; readonly scriptRevision: number; readonly styles: readonly PageSource[]; readonly scripts: readonly PageSource[] }
export interface PageSourcesPort {
  page(): Promise<PageSources>;
  toggle(page: PageSources, kind: SourceKind, id: string, enabled: boolean): Promise<PageSources>;
}
export function decodePageSources(input: unknown): PageSources {
  const p = input as PageSources;
  if (!p || typeof p !== 'object' || typeof p.tabId !== 'string' || typeof p.url !== 'string' || !Number.isSafeInteger(p.styleRevision) || p.styleRevision < 0 || !Number.isSafeInteger(p.scriptRevision) || p.scriptRevision < 0) throw new Error('Invalid page sources');
  for (const kind of ['styles', 'scripts'] as const) {
    if (!Array.isArray(p[kind]) || p[kind].length > 256 || p[kind].some(i => !i || typeof i.id !== 'string' || typeof i.name !== 'string' || typeof i.enabled !== 'boolean' || i.manual !== undefined && typeof i.manual !== 'boolean')) throw new Error('Invalid page sources');
  }
  return p;
}
