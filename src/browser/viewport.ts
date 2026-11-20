import type { Command, SurfaceRect } from './protocol';

export function surfaceRect(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, inset = 0, rounding: 'inside' | 'cover' = 'inside'): SurfaceRect {
  const start = rounding === 'cover' ? Math.floor : Math.ceil;
  const end = rounding === 'cover' ? Math.ceil : Math.floor;
  const x = Math.max(0, start(rect.left + inset));
  const y = Math.max(0, start(rect.top + inset));
  return { x, y, width: Math.max(0, end(rect.right - inset) - x), height: Math.max(0, end(rect.bottom - inset) - y) };
}

const overlaySelector = '.address-suggestions, .browser-menu, .tab-menu, .error, .style-manager, .blocking-log, .credential-autofill, .workspace-popover, .haz-workspace-menu, .split-divider';
const captureSelector = '#downloads-popover:not([hidden]), dialog[open], .shell-overlay-exit, [data-internal-page], .split-drag-surface:not([hidden])';
const surfaceSelector = `#downloads-popover, ${overlaySelector}, dialog, .shell-overlay-exit, #content-surface, .split-drag-surface`;

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
    const captureInput = !!document.querySelector(captureSelector);
    const overlays = captureInput ? [] : Array.from(document.querySelectorAll(overlaySelector), element => surfaceRect(element.getBoundingClientRect()));
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
  const observed = new Set<Element>();
  const syncSurfaces = () => {
    const next = new Set(document.querySelectorAll(surfaceSelector));
    for (const element of observed) if (!next.has(element)) { resize.unobserve(element); observed.delete(element); }
    for (const element of next) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
  };
  const containsSurface = (node: Node) => node instanceof window.Element &&
    (node.matches(surfaceSelector) || !!node.querySelector(surfaceSelector));
  const mutations = new window.MutationObserver(records => {
    const structural = records.some(record => record.type === 'childList' &&
      [...record.addedNodes, ...record.removedNodes].some(containsSurface));
    const geometry = records.some(record => record.type === 'attributes' &&
      (observed.has(record.target as Element) || (record.target as Element).matches(surfaceSelector)));
    if (structural || geometry) { syncSurfaces(); schedule(); }
  });
  mutations.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden', 'data-internal-page'], childList: true, subtree: true });
  syncSurfaces();
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    disposed = true;
    resize.disconnect(); mutations.disconnect();
    window.removeEventListener('resize', schedule);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
}
