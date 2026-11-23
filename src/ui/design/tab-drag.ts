import type { ShellController } from '../../browser/controller';
import { canDropTab, projectTabMove, type TabPlacement } from '../../browser/tab-tree';
import { tabUnits, type TabDragPreview } from '../../browser/splits';
import './tab-drag.css';

function visualCopy(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of ['id', 'data-tab-id', 'role', 'title']) node.removeAttribute(attr);
  }
  return copy;
}

export function tabDragPreview(controller: ShellController) {
  return (sourceId: string, downX: number, downY: number): TabDragPreview | undefined => {
    const tabList = document.querySelector<HTMLElement>('.shell.vertical .tab-list');
    if (!tabList) return;
    const list = tabList;
    const sidebar = list.parentElement!;
    const browser = controller.state().browser;
    const source = browser.tabs.find(tab => tab.id === sourceId)!;
    const originals = new Map(Array.from(list.querySelectorAll<HTMLElement>('[role=tab]'), button =>
      [button.dataset.tabId!, button.closest<HTMLElement>('.tab')!] as const));
    const row = originals.get(sourceId);
    if (!row) return;
    const bounds = row.getBoundingClientRect();
    const area = list.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'tab-list drag-projection';
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { left: area.left+'px', top: area.top+'px', width: area.width+'px', height: area.height+'px' });
    const pins = document.createElement('div');
    pins.className = 'pinned-tabs';
    const copies = new Map(Array.from(originals, ([id, el]) => [id, visualCopy(el)]));
    const slot = copies.get(sourceId)!;
    slot.classList.add('drag-slot');
    const lifted = visualCopy(row);
    lifted.classList.add('drag-lifted');
    lifted.classList.toggle('drag-pin', !!source.pinned);
    Object.assign(lifted.style, { left: bounds.left+'px', top: bounds.top+'px', width: bounds.width+'px', height: bounds.height+'px' });
    sidebar.append(layer, lifted);
    list.classList.add('drag-original');
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previous = '', scrollFrame = 0, scrollSpeed = 0;
    let pointer: PointerEvent;
    const motions = new Map<HTMLElement, Animation>();
    const draw = (tabId?: string, placement: TabPlacement = 'after') => {
      const key = JSON.stringify([tabId, placement]);
      if (previous === key) return;
      const wasDrawn = !!previous;
      previous = key;
      const old = new Map([...copies].map(([id, el]) => [id, el.getBoundingClientRect()]));
      for (const motion of motions.values()) motion.cancel();
      motions.clear();
      const projected = tabId ? {...browser, ...projectTabMove(browser.tabs, browser.splits ?? [], sourceId, tabId, placement)} : browser;
      const parents = new Set(projected.tabs.map(tab => tab.parentId).filter(Boolean));
      layer.replaceChildren();
      pins.replaceChildren();
      for (const unit of tabUnits(projected)) {
        const pinned = unit.tabs[0]!.pinned;
        const wrap = document.createElement('div');
        wrap.className = 'tab-unit' + (pinned ? ' pinned-tab-unit' : '') + (unit.tabs.length === 2 ? ' split-tab' : '');
        if (pinned && !pins.parentNode) layer.append(pins);
        (pinned ? pins : layer).append(wrap);
        for (const tab of unit.tabs) {
          const copy = copies.get(tab.id)!;
          copy.classList.toggle('tree-child', !!tab.parentId);
          copy.classList.toggle('tree-root', parents.has(tab.id));
          if (tab.parentId || parents.has(tab.id)) copy.dataset.group = tab.parentId ?? tab.id;
          else delete copy.dataset.group;
          copy.toggleAttribute('data-drag-parent', placement === 'inside' && tab.id === projected.tabs.find(t => t.id === sourceId)?.parentId);
          if (tab.parentId && projected.tabs[projected.tabs.indexOf(tab) + 1]?.parentId !== tab.parentId) copy.dataset.groupEnd = 'true';
          else delete copy.dataset.groupEnd;
          wrap.append(copy);
        }
      }
      layer.scrollTop = list.scrollTop;
      if (!animate || !wasDrawn) return;
      const positions = [...copies].map(([id, el]) => ({el, before: old.get(id)!, after: el.getBoundingClientRect()}));
      for (const {el, before, after} of positions) {
        const dx = before.left-after.left, dy = before.top-after.top;
        if (el === slot || (!dx && !dy)) continue;
        motions.set(el, el.animate([{transform: 'translate('+dx+'px,'+dy+'px)'}, {transform: 'none'}],
          {duration: 145, easing: 'cubic-bezier(.2,.7,.2,1)'}));
      }
    };
    const syncScroll = () => { layer.scrollTop = list.scrollTop; };
    list.addEventListener('scroll', syncScroll);
    const autoScroll = () => {
      scrollFrame = 0;
      const before = list.scrollTop;
      list.scrollTop += scrollSpeed;
      if (before !== list.scrollTop) target(pointer);
    };
    function target(event: PointerEvent) {
      pointer = event;
      const x = event.clientX, y = event.clientY;
      lifted.style.transform = 'translate('+(x-downX)+'px,'+(y-downY)+'px)';
      // Only the original, stationary hit boxes participate. Animated neighbours
      // cannot switch the target back underneath a stationary pointer.
      const hit = document.elementFromPoint(x, y);
      const inside = !!hit && sidebar.contains(hit);
      const over = inside && list.contains(hit) ? hit.closest('.tab-unit') : null;
      const hovered = hit?.closest('.tab') ?? over?.querySelector('.tab');
      let tabId = hovered?.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId;
      if (!tabId && inside && list.contains(hit) && x >= area.left && x <= area.right) {
        // A flex gap is part of the neighbouring drop zones too.
        let nearest = Infinity;
        for (const [id, original] of originals) {
          const rect = original.getBoundingClientRect();
          const dx = Math.max(rect.left-x, 0, x-rect.right);
          const dy = Math.max(rect.top-y, 0, y-rect.bottom);
          if (dx*dx + dy*dy < nearest) { nearest = dx*dx + dy*dy; tabId = id; }
        }
      }
      let placement: TabPlacement = 'after';
      if (inside && !tabId && y >= area.bottom && !source.pinned) {
        tabId = browser.tabs.findLast(tab => !tab.pinned && !tab.parentId && tab.id !== sourceId)?.id;
      } else if (tabId) {
        const before = browser.tabs.findIndex(t => t.id === tabId) < browser.tabs.indexOf(source);
        placement = before ? 'before' : 'after';
        if (!source.pinned && x-downX >= 24 && canDropTab(browser.tabs, sourceId, tabId, 'inside')) placement = 'inside';
      }
      if (!tabId || !canDropTab(browser.tabs, sourceId, tabId, placement)) tabId = undefined;
      draw(tabId, placement);
      scrollSpeed = inside && y >= area.top && y <= area.bottom
        ? Math.max(0, 24-(area.bottom-y))/3 - Math.max(0, 24-(y-area.top))/3 : 0;
      if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
      return {tabId, placement};
    }
    return {target, dispose(settle) {
      cancelAnimationFrame(scrollFrame);
      for (const motion of motions.values()) motion.cancel();
      list.removeEventListener('scroll', syncScroll);
      list.classList.remove('drag-original');
      layer.remove();
      if (!settle || !animate) { lifted.remove(); return; }
      const from = lifted.getBoundingClientRect();
      requestAnimationFrame(() => {
        const destination = list.querySelector<HTMLElement>('[data-tab-id="'+CSS.escape(sourceId)+'"]')?.closest<HTMLElement>('.tab');
        if (!destination || !lifted.isConnected) { lifted.remove(); return; }
        const to = destination.getBoundingClientRect();
        if (Math.hypot(to.x-from.x, to.y-from.y) < 2) { lifted.remove(); return; }
        destination.classList.add('drag-landing');
        const landing = lifted.animate([
          {transform: 'translate('+(from.x-bounds.x)+'px,'+(from.y-bounds.y)+'px)'},
          {transform: 'translate('+(to.x-bounds.x)+'px,'+(to.y-bounds.y)+'px)'},
        ], {duration: 115, easing: 'ease-out', fill: 'forwards'});
        const finish = () => { destination.classList.remove('drag-landing'); lifted.remove(); };
        landing.onfinish = landing.oncancel = finish;
      });
    }};
  };
}
