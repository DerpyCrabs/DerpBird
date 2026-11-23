export function sidebarWidth(value: number, viewportWidth: number, minimum = 120): number {
  return Math.round(Math.max(minimum, Math.min(value, 600, Math.max(minimum, viewportWidth / 2))));
}

/** Preview at most once per frame; persist only when the gesture completes. */
export function observeSidebarResize(document: Document, preview: (width: number | null) => void, commit: (width: number) => void) {
  const window = document.defaultView!;
  let handle = document.getElementById('sidebar-resize');
  if (!handle) return () => {};
  const direction = () => document.querySelector('.shell.tabs-right') ? -1 : 1;
  const constrain = (width: number) => sidebarWidth(width, window.innerWidth,
    Number(document.getElementById('sidebar-resize')?.getAttribute('aria-valuemin')) || 120);
  let drag: { pointer: number; startX: number; startWidth: number; width: number } | undefined;
  let frame: number | undefined;
  const flush = () => { frame = undefined; if (drag) preview(drag.width); };
  const down = (event: PointerEvent) => {
    const target = event.target instanceof window.HTMLElement ? event.target.closest<HTMLElement>('#sidebar-resize') : null;
    if (event.button !== 0 || !target) return;
    handle = target;
    event.preventDefault();
    const width = document.querySelector('.tabs')!.getBoundingClientRect().width;
    drag = { pointer: event.pointerId, startX: event.clientX, startWidth: width, width };
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute('data-resizing', '');
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.width = constrain(drag.startWidth + (event.clientX - drag.startX) * direction());
    if (frame === undefined) frame = window.requestAnimationFrame(flush);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    const width = constrain(drag.startWidth + (event.clientX - drag.startX) * direction());
    drag = undefined;
    handle!.removeAttribute('data-resizing');
    document.getElementById('sidebar-resize')?.removeAttribute('data-resizing');
    if (event.type === 'pointercancel') preview(null);
    else { preview(width); commit(width); }
    if (handle!.hasPointerCapture(event.pointerId)) handle!.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent) => {
    if (!(event.target instanceof window.HTMLElement) || event.target.id !== 'sidebar-resize') return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = document.querySelector('.tabs')!.getBoundingClientRect().width;
    commit(constrain(event.key === 'Home' ? 120 : event.key === 'End' ? 600 : width + (event.key === 'ArrowLeft' ? -10 : 10) * direction()));
  };
  const reset = (event: MouseEvent) => { if (event.target instanceof window.HTMLElement && event.target.id === 'sidebar-resize') commit(constrain(196)); };
  // The reactive shell may replace the separator during a width preview.
  // Keep the gesture on the document so pointer-up still commits or cancels.
  document.addEventListener('pointerdown', down);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('keydown', key);
  document.addEventListener('dblclick', reset);
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', down); document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish);
    document.removeEventListener('keydown', key); document.removeEventListener('dblclick', reset);
  };
}
