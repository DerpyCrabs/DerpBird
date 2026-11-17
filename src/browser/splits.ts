import type { BrowserSnapshot, Tab, SplitView } from './protocol';
import type { ShellController } from './controller';
import { canDropTab, tabDropPlacement } from './tab-tree';

export function splitFor(browser: BrowserSnapshot, tabId: string | undefined | null) {
  return browser.splits?.find(split => split.firstTabId === tabId || split.secondTabId === tabId);
}

/** Place each pair at its first encountered member, retaining its page order. */
export function tabUnits(browser: BrowserSnapshot): { id: string; tabs: readonly Tab[] }[] {
  if (!browser.splits?.length) return browser.tabs.map(tab => ({ id: tab.id, tabs: [tab] }));
  const pairs = new Map<string, SplitView>();
  for (const split of browser.splits) {
    pairs.set(split.firstTabId, split);
    pairs.set(split.secondTabId, split);
  }
  const byId = new Map(browser.tabs.map(tab => [tab.id, tab]));
  const units: { id: string; tabs: readonly Tab[] }[] = [];
  const emitted = new Set<SplitView>();
  for (const tab of browser.tabs) {
    const split = pairs.get(tab.id);
    if (!split) units.push({ id: tab.id, tabs: [tab] });
    else if (!emitted.has(split)) {
      units.push({ id: `split:${split.id}`, tabs: [byId.get(split.firstTabId)!, byId.get(split.secondTabId)!] });
      emitted.add(split);
    }
  }
  return units;
}

function tabLayout(browser: BrowserSnapshot) {
  const pinned = [], regular = [];
  const parents = new Set<string>();
  for (const tab of browser.tabs) if (tab.parentId) parents.add(tab.parentId);
  for (const unit of tabUnits(browser)) {
    if (unit.tabs[0]!.pinned) pinned.push(unit);
    else regular.push(unit);
  }
  return { pinned, regular, parents };
}

// Shell interactions republish the same immutable browser snapshot.
const layouts = new WeakMap<BrowserSnapshot, ReturnType<typeof tabLayout>>();
export function shellTabLayout(browser: BrowserSnapshot) {
  let layout = layouts.get(browser);
  if (!layout) {
    layout = tabLayout(browser);
    layouts.set(browser, layout);
  }
  return layout;
}

export function splitEdge(x: number, y: number, width: number, height: number): 'left' | 'right' | 'top' | 'bottom' | undefined {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return;
  const distances = [x / width, (width - x) / width, y / height, (height - y) / height];
  const nearest = Math.min(...distances);
  return nearest <= .25 ? (['left', 'right', 'top', 'bottom'] as const)[distances.indexOf(nearest)] : undefined;
}
export const splitRatio = (position: number, length: number) => Math.max(.2, Math.min(.8, (position - 3) / Math.max(1, length - 6)));

/** Own the whole gesture, including grouping, without relying on pointer capture
 * (not implemented by every supported engine). The temporary page overlay gives
 * the shell native input ownership before a pointer leaves the tab strip. */
export function observeSplitInteractions(document: Document, controller: Pick<ShellController, 'state' | 'send'>) {
  const window = document.defaultView!;
  const content = document.getElementById('content-surface');
  const overlay = document.querySelector<HTMLElement>('.split-drag-surface');
  if (!content || !overlay) return () => {};
  type Drag = { pointer: number; x: number; y: number; tabId: string; started: boolean; layout: string };
  let drag: Drag | undefined;
  let resize: { pointer: number; split: SplitView; ratio: number } | undefined;
  let suppressClick = false;
  let frame: number | undefined;
  const clearMarkers = () => document.querySelectorAll('[data-drop]').forEach(node => node.removeAttribute('data-drop'));
  const reset = () => {
    drag = undefined; resize = undefined;
    overlay.hidden = true; overlay.removeAttribute('data-edge'); clearMarkers();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const layoutKey = () => JSON.stringify(controller.state().chromeLayout ?? controller.state().layout);
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof window.Element)) return;
    suppressClick = false;
    const divider = event.target.closest('.split-divider');
    if (divider) {
      const split = splitFor(controller.state().browser, divider.getAttribute('data-tab-id'));
      if (!split) return;
      event.preventDefault();
      resize = { pointer: event.pointerId, split, ratio: split.ratio };
      overlay.hidden = false;
      return;
    }
    const tab = event.target.closest<HTMLElement>('[role=tab]');
    if (!tab?.dataset.tabId) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, tabId: tab.dataset.tabId, started: false, layout: layoutKey() };
  };
  const targetAt = (event: PointerEvent) => {
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.tab');
    const tabId = row?.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId;
    const rect = row?.getBoundingClientRect();
    const vertical = controller.state().layout === 'vertical';
    const placement = rect ? tabDropPlacement(vertical ? event.clientY - rect.top : event.clientX - rect.left, vertical ? rect.height : rect.width) : 'after';
    return { row, tabId, placement };
  };
  const edgeAt = (event: PointerEvent) => {
    const rect = content.getBoundingClientRect();
    return splitEdge(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  };
  const move = (event: PointerEvent) => {
    if (resize && event.pointerId === resize.pointer) {
      const rect = content.getBoundingClientRect();
      resize.ratio = resize.split.axis === 'horizontal' ? splitRatio(event.clientX - rect.left, rect.width) : splitRatio(event.clientY - rect.top, rect.height);
      if (frame === undefined) frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (resize) controller.send({ type: 'split.resize', tabId: resize.split.firstTabId, ratio: resize.ratio });
      });
      return;
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.layout !== layoutKey()) { reset(); return; }
    if (!drag.started && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    drag.started = true; suppressClick = true; overlay.hidden = false;
    event.preventDefault(); clearMarkers();
    const browser = controller.state().browser;
    const source = browser.tabs.find(tab => tab.id === drag!.tabId);
    const active = browser.tabs.find(tab => tab.id === browser.activeTabId);
    const edge = source && active && source !== active && source.private === active.private && !source.pinned && !active.pinned ? edgeAt(event) : undefined;
    if (edge) overlay.dataset.edge = edge; else overlay.removeAttribute('data-edge');
    const target = targetAt(event);
    if (target.tabId && canDropTab(browser.tabs, drag.tabId, target.tabId, target.placement)) target.row!.dataset.drop = target.placement;
  };
  const up = (event: PointerEvent) => {
    if (resize && event.pointerId === resize.pointer) {
      controller.send({ type: 'split.resize', tabId: resize.split.firstTabId, ratio: resize.ratio });
      reset(); return;
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.layout !== layoutKey()) { reset(); return; }
    if (drag.started) {
      const browser = controller.state().browser;
      const edge = overlay.dataset.edge as ReturnType<typeof splitEdge>;
      const target = targetAt(event);
      if (edge && browser.activeTabId) controller.send({ type: 'tab.split', tabId: drag.tabId, targetId: browser.activeTabId, edge });
      else if (target.tabId && canDropTab(browser.tabs, drag.tabId, target.tabId, target.placement)) controller.send({ type: 'tab.tree-move', tabId: drag.tabId, targetId: target.tabId, placement: target.placement });
      else if (document.elementFromPoint(event.clientX, event.clientY)?.closest('.tabs') && !target.tabId) {
        const last = browser.tabs.findLast(tab => !tab.parentId && tab.id !== drag!.tabId);
        if (last && canDropTab(browser.tabs, drag.tabId, last.id, 'after')) controller.send({ type: 'tab.tree-move', tabId: drag.tabId, targetId: last.id, placement: 'after' });
      }
    }
    reset();
  };
  const click = (event: MouseEvent) => {
    const suppress = suppressClick;
    suppressClick = false;
    if (suppress && event.target instanceof window.Element && event.target.closest('.tab-unit')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (drag || resize)) {
      if (resize) controller.send({ type: 'split.resize', tabId: resize.split.firstTabId, ratio: resize.split.ratio });
      event.preventDefault(); reset(); return;
    }
    if (!(event.target instanceof window.Element) || !event.target.closest('.split-divider')) return;
    const split = splitFor(controller.state().browser, controller.state().browser.activeTabId);
    if (!split) return;
    const keys = split.axis === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (![...keys, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const ratio = event.key === 'Home' ? .2 : event.key === 'End' ? .8 : Math.max(.2, Math.min(.8, split.ratio + (event.key === keys[0] ? -.05 : .05)));
    controller.send({ type: 'split.resize', tabId: split.firstTabId, ratio });
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', reset);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key);
  window.addEventListener('blur', reset);
  return () => {
    reset();
    document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', reset);
    document.removeEventListener('click', click, true); document.removeEventListener('keydown', key);
    window.removeEventListener('blur', reset);
  };
}
