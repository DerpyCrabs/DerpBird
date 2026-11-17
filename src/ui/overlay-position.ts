/** Keep anchored surfaces inside the window after Base UI resolves placement. */
export function observePopupPosition(element: HTMLElement) {
  const inset = 8;
  const update = () => {
    if (!element.matches(':popover-open')) return;
    const viewport = element.ownerDocument.documentElement;
    const dimensions = [
      ['left', element.offsetWidth, viewport.clientWidth],
      ['top', element.offsetHeight, viewport.clientHeight],
    ] as const;
    for (const [property, size, extent] of dimensions) {
      const position = parseFloat(element.style[property]);
      if (!Number.isFinite(position)) continue;
      const constrained = Math.max(
        inset,
        Math.min(position, extent - size - inset),
      );
      if (position !== constrained)
        element.style[property] = `${constrained}px`;
    }
    // Our own coordinate writes do not need another positioning pass.
    mutations.takeRecords();
  };
  const mutations = new MutationObserver(update);
  mutations.observe(element, { attributes: true, attributeFilter: ['style'] });
  const resize = new ResizeObserver(update);
  resize.observe(element);
  element.addEventListener('toggle', update);
  window.addEventListener('resize', update);
  update();
  return () => {
    mutations.disconnect();
    resize.disconnect();
    element.removeEventListener('toggle', update);
    window.removeEventListener('resize', update);
  };
}
