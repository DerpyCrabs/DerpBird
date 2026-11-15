export interface RequestRecord {
  id: string; url: string; method: string; status: number; type: string;
  complete?: boolean; failed?: boolean;
  bytes: number; start: number; duration: number; initiator: string;
  headers: Record<string, string>; requestHeaders: Record<string, string>; payload?: string;
}
export interface ImageResponse { encoding: 'base64'; mimeType: string; data: string; bytes: number }
export interface DOMRecord { id: string; depth: number; text: string; styles: Record<string, string> }
export interface SourceRecord { id?: string; name: string; text: string }
export interface ConsoleRecord { level: 'info' | 'warning' | 'error' | 'result'; text: string; source?: string }
export type DockPosition = 'left' | 'right' | 'bottom' | 'window';
export interface DevToolsUpdate {
  revealElement?: boolean;
  dock?: DockPosition; picking?: boolean;
  requests?: RequestRecord[]; elements?: DOMRecord[]; sources?: SourceRecord[];
  messages?: ConsoleRecord[]; selectedNodeId?: string; error?: string;
}
/** Native and demo adapters implement the same observable transport boundary. */
export interface DevToolsPort {
  requests: RequestRecord[]; elements: DOMRecord[]; sources: SourceRecord[]; messages: ConsoleRecord[];
  dock?: DockPosition; picking?: boolean;
  setDock?(position: DockPosition): Promise<void>;
  pickElement?(): Promise<void>;
  dismiss?(): Promise<void>;
  selectedNodeId?: string;
  subscribe?(listener: (update: DevToolsUpdate) => void): () => void;
  selectElement?(id: string): Promise<void>;
  source?(id: string): Promise<string>;
  clearRequests?(): Promise<void>;
  refresh?(): Promise<void>;
  response(id: string): Promise<string | ImageResponse>;
  evaluate(expression: string): Promise<string>;
}
export interface TreeRow { id: number; parent: number; depth: number; key: string; value: string; branch: boolean; end: number }
/** Iterative traversal avoids overflowing the stack on deeply nested responses. */
export function indexJSON(value: unknown): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: { value: unknown; key: string; parent: number; depth: number; exit?: number }[] = [{ value, key: '$', parent: -1, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit !== undefined) { rows[item.exit]!.end = rows.length; continue; }
    const branch = item.value !== null && typeof item.value === 'object';
    const entries = branch ? Object.entries(item.value as object) : [];
    const id = rows.length;
    rows.push({ id, parent: item.parent, depth: item.depth, key: item.key, branch, end: id + 1,
      value: branch ? Array.isArray(item.value) ? `Array(${entries.length})` : `{${entries.length}}` : JSON.stringify(item.value) ?? 'undefined' });
    if (branch) {
      stack.push({ ...item, exit: id });
      for (let i = entries.length - 1; i >= 0; i--) stack.push({ value: entries[i]![1], key: entries[i]![0], parent: id, depth: item.depth + 1 });
    }
  }
  return rows;
}
export function visibleTree(rows: TreeRow[], expanded: ReadonlySet<number>): TreeRow[] {
  const visible: TreeRow[] = [];
  for (let i = 0; i < rows.length;) { const row = rows[i]!; visible.push(row); i = row.branch && !expanded.has(row.id) ? row.end : i + 1; }
  return visible;
}
export function searchTree(rows: TreeRow[], query: string, sensitive = false): number[] {
  if (!query) return [];
  const needle = sensitive ? query : query.toLowerCase();
  return rows.filter(row => (sensitive ? `${row.key}: ${row.value}` : `${row.key}: ${row.value}`.toLowerCase()).includes(needle)).map(row => row.id);
}
export function revealMatch(rows: TreeRow[], expanded: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(expanded);
  for (let parent = rows[id]?.parent ?? -1; parent !== -1; parent = rows[parent]!.parent) next.add(parent);
  return next;
}
export function windowRange(length: number, scroll: number, height: number, rowHeight = 26) {
  const start = Math.max(0, Math.min(Math.floor(scroll / rowHeight) - 8, Math.max(0, length - 1)));
  return { start, end: Math.min(length, start + Math.ceil(height / rowHeight) + 16) };
}
export function filterRequests(requests: RequestRecord[], query: string, type: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return requests.filter(r => (type === 'All' || r.type === type) && terms.every(term => {
    if (term.startsWith('status:')) return String(r.status) === term.slice(7);
    if (term.startsWith('method:')) return r.method.toLowerCase() === term.slice(7);
    return r.url.toLowerCase().includes(term);
  }));
}
export function bytes(size: number) { return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} kB` : `${(size / 1048576).toFixed(1)} MB`; }
