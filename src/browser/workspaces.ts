export const workspaceIcons = ['research', 'home', 'code', 'leaf'] as const;
export const workspaceColors = ['sage', 'peach', 'lilac', 'blue'] as const;
export interface Workspace { readonly id: string; readonly name: string; readonly icon: typeof workspaceIcons[number]; readonly color: typeof workspaceColors[number] }
export interface Workspaces { readonly active: string; readonly items: readonly Workspace[] }
export interface WorkspaceDraft { readonly id?: string; readonly name: string; readonly icon: Workspace['icon']; readonly color: Workspace['color'] }
export function decodeWorkspaces(value: unknown): Workspaces | undefined {
  if (value === undefined) return undefined;
  const v = value as Workspaces;
  if (!v || !Array.isArray(v.items) || !v.items.length || v.items.length > 64) throw Error('Invalid workspaces');
  const ids = new Set<string>();
  const items = v.items.map(w => {
    if (!w || typeof w.id !== 'string' || !w.id || w.id.length > 128 || ids.has(w.id) || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 32 || !workspaceIcons.includes(w.icon) || !workspaceColors.includes(w.color)) throw Error('Invalid workspace');
    ids.add(w.id); return Object.freeze({ id: w.id, name: w.name, icon: w.icon, color: w.color });
  });
  if (!ids.has(v.active)) throw Error('Invalid active workspace');
  return Object.freeze({active:v.active, items:Object.freeze(items)});
}
