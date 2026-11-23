import type { Tab, SplitView } from './protocol';
export type TabPlacement = 'before' | 'inside' | 'after';

export function tabDropPlacement(position: number, length: number): TabPlacement {
  const fraction = length > 0 ? position / length : 0.5;
  return fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'inside';
}

export function canDropTab(tabs: readonly Tab[], sourceId: string, targetId: string, placement: TabPlacement): boolean {
  const source = tabs.find(tab => tab.id === sourceId);
  const target = tabs.find(tab => tab.id === targetId);
  if (!source || !target || source === target || source.private !== target.private || source.pinned !== target.pinned || target.parentId === source.id) return false;
  const parentId = placement === 'inside' ? target.parentId ?? target.id : target.parentId;
  return !parentId || (!source.pinned && !tabs.some(tab => tab.parentId === source.id));
}

/** Project the same tree order for a drag preview and for the committed move. */
export function projectTabMove(tabs: readonly Tab[], splits: readonly SplitView[], id: string, targetId: string, placement: TabPlacement) {
 const source=tabs.find(tab=>tab.id===id)!, target=tabs.find(tab=>tab.id===targetId)!;
 const remaining=tabs.filter(tab=>tab.id!==id && tab.parentId!==id);
 const nextSplits=splits.filter(pair=>pair.firstTabId!==id && pair.secondTabId!==id);
 const targetPair=nextSplits.find(pair=>pair.firstTabId===targetId || pair.secondTabId===targetId);
 const parentId=placement==='inside'?(targetPair?.firstTabId??target.parentId??targetId):target.parentId;
 const anchor=placement==='inside'?parentId!:targetId;
 let index=remaining.findIndex(tab=>tab.id===anchor);
 if(placement!=='before'){
  index++;
  while(remaining[index]?.parentId===anchor)index++;
 }
 remaining.splice(index,0,{...source,parentId},...tabs.filter(tab=>tab.parentId===id));
 return {tabs:remaining,splits:nextSplits};
}
