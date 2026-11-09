export function sidebarWidth(value: number, viewportWidth: number): number {
  return Math.round(Math.max(120, Math.min(value, 600, Math.max(120, viewportWidth / 2))));
}

/** Preview at most once per frame; persist only when the gesture completes. */
export function observeSidebarResize(document: Document, preview: (width: number | null) => void, commit: (width: number) => void) {
  const window = document.defaultView!;
  const handle = document.getElementById('sidebar-resize');
  if (!handle) return () => {};
  let drag: { pointer: number; startX: number; startWidth: number; width: number } | undefined;
  let frame: number | undefined;
  const flush = () => { frame = undefined; if (drag) preview(drag.width); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const width = document.querySelector('.tabs')!.getBoundingClientRect().width;
    drag = { pointer: event.pointerId, startX: event.clientX, startWidth: width, width };
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute('data-resizing', '');
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.width = sidebarWidth(drag.startWidth + event.clientX - drag.startX, window.innerWidth);
    if (frame === undefined) frame = window.requestAnimationFrame(flush);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    const width = sidebarWidth(drag.startWidth + event.clientX - drag.startX, window.innerWidth);
    drag = undefined;
    handle.removeAttribute('data-resizing');
    if (event.type === 'pointercancel') preview(null);
    else { preview(width); commit(width); }
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = document.querySelector('.tabs')!.getBoundingClientRect().width;
    commit(sidebarWidth(event.key === 'Home' ? 120 : event.key === 'End' ? 600 : width + (event.key === 'ArrowLeft' ? -10 : 10), window.innerWidth));
  };
  const reset = () => commit(196);
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', key);
  handle.addEventListener('dblclick', reset);
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish);
    handle.removeEventListener('keydown', key); handle.removeEventListener('dblclick', reset);
  };
}
