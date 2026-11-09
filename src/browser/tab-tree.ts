import type { Tab } from './protocol';
export type TabPlacement = 'before' | 'inside' | 'after';

export function tabDropPlacement(position: number, length: number): TabPlacement {
  const fraction = length > 0 ? position / length : 0.5;
  return fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'inside';
}

export function canDropTab(tabs: readonly Tab[], sourceId: string, targetId: string, placement: TabPlacement): boolean {
  const source = tabs.find(tab => tab.id === sourceId);
  const target = tabs.find(tab => tab.id === targetId);
  if (!source || !target || source === target || source.pinned !== target.pinned || target.parentId === source.id) return false;
  const parentId = placement === 'inside' ? target.parentId ?? target.id : target.parentId;
  return !parentId || (!source.pinned && !tabs.some(tab => tab.parentId === source.id));
}
