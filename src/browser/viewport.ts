import type { Command, SurfaceRect } from './protocol';

export function surfaceRect(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, inset = 0, rounding: 'inside' | 'cover' = 'inside'): SurfaceRect {
  const start = rounding === 'cover' ? Math.floor : Math.ceil;
  const end = rounding === 'cover' ? Math.ceil : Math.floor;
  const x = Math.max(0, start(rect.left + inset));
  const y = Math.max(0, start(rect.top + inset));
  return { x, y, width: Math.max(0, end(rect.right - inset) - x), height: Math.max(0, end(rect.bottom - inset) - y) };
}

/** Coalesce geometry changes into one update per frame; no idle polling. */
export function observeViewport(document: Document, send: (command: Command) => void, connected: () => boolean) {
  const window = document.defaultView!;
  const content = document.getElementById('content-surface');
  if (!content) return () => {};
  let frame: number | undefined;
  let previous = '';
  let disposed = false;
  const publish = () => {
    frame = undefined;
    if (disposed || !connected()) return;
    // The page is below the transparent shell: cover fractional edges instead of
    // leaving an uncovered strip between the toolbar and the native surface.
    const rect = surfaceRect(content.getBoundingClientRect(), 0, 'cover');
    // Input capture raises the transparent shell above the native page. Keep
    // the entire page painted, including behind rounded dialog corners/shadows.
    const captureInput = !!document.querySelector('dialog[open], .split-drag-surface:not([hidden])');
    const overlays = captureInput ? [] : Array.from(document.querySelectorAll('.address-suggestions, .browser-menu, .tab-menu, .error, .style-manager, .blocking-log, .credential-autofill, .split-divider'), element => surfaceRect(element.getBoundingClientRect()));
    const command = { type: 'shell.viewport', rect, overlays, ...(captureInput ? { captureInput: true } : {}) } as const;
    const serialized = JSON.stringify(command);
    if (serialized === previous) return;
    previous = serialized;
    send(command);
  };
  const schedule = () => {
    if (!disposed && frame === undefined) frame = window.requestAnimationFrame(publish);
  };
  const resize = new window.ResizeObserver(schedule);
  resize.observe(content);
  resize.observe(document.documentElement);
  const mutations = new window.MutationObserver(schedule);
  mutations.observe(document.getElementById('app')!, { attributes: true, childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    disposed = true;
    resize.disconnect(); mutations.disconnect();
    window.removeEventListener('resize', schedule);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
}
