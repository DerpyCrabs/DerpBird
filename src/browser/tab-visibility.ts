/** Keep the selected tab inside its own scroller without moving keyboard focus. */
export function observeActiveTab(document: Document): () => void {
  const window = document.defaultView!;
  const list = document.querySelector<HTMLElement>('.tab-list');
  const shell = document.querySelector<HTMLElement>('.shell');
  if (!list || !shell) return () => {};
  let frame: number | undefined;
  let disposed = false;
  const reveal = () => {
    frame = undefined;
    if (disposed) return;
    const selected = list.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.closest<HTMLElement>('.tab');
    if (!selected) return;
    const bounds = list.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    // Only scroll the tab strip. scrollIntoView could also move the shell.
    if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left;
    else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right;
    if (tab.top < bounds.top) list.scrollTop += tab.top - bounds.top;
    else if (tab.bottom > bounds.bottom) list.scrollTop += tab.bottom - bounds.bottom;
  };
  const schedule = () => {
    if (!disposed && frame === undefined) frame = window.requestAnimationFrame(reveal);
  };
  const mutations = new window.MutationObserver(records => {
    if (records.some(record => record.type === 'childList' ? record.target === list
      : record.oldValue !== (record.target as Element).getAttribute(record.attributeName!))) schedule();
  });
  mutations.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'], attributeOldValue: true });
  mutations.observe(shell, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  const resize = new window.ResizeObserver(schedule);
  resize.observe(list);
  schedule();
  return () => {
    disposed = true;
    mutations.disconnect(); resize.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
}
