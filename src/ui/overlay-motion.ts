import './overlay-motion.css';

/** Keep only an inert visual after unmount; focus and dismissal stay synchronous. */
export function observeOverlayMotion(element: HTMLElement) {
  let bounds = element.getBoundingClientRect();
  let content: HTMLElement | undefined;
  let backdrop = 'transparent';
  let frame = 0;
  let contentDirty = true;
  const measure = () => {
    frame = 0;
    const next = element.getBoundingClientRect();
    if (
      next.width &&
      next.height &&
      (element.matches(':popover-open') || element.matches('dialog[open]'))
    ) {
      bounds = next;
      if (contentDirty) {
        content = element.cloneNode(true) as HTMLElement;
        contentDirty = false;
      }
      backdrop = getComputedStyle(element, '::backdrop').backgroundColor;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const mutations = new MutationObserver((records) => {
    records = records.filter(
      (record) =>
        !['tabindex', 'aria-activedescendant', 'data-highlighted'].includes(
          record.attributeName ?? '',
        ),
    );
    if (!records.length) return;
    // Placement and focus bookkeeping do not change the exit image's children.
    if (
      records.some(
        (record) =>
          record.type !== 'attributes' ||
          (record.target !== element &&
            !['tabindex', 'aria-activedescendant', 'data-highlighted'].includes(
              record.attributeName ?? '',
            )),
      )
    )
      contentDirty = true;
    schedule();
  });
  mutations.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(element);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    if (element.isConnected) measure();
    resize.disconnect();
    mutations.disconnect();
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !bounds.width ||
      !content
    )
      return;
    const ghost = document.createElement('div');
    ghost.className = element.className;
    ghost.append(...Array.from(content.childNodes));
    ghost.style.setProperty('--shell-exit-backdrop', backdrop);
    ghost.classList.add('shell-overlay-exit');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    // No duplicate IDs, focusable controls, or live regions during the exit.
    for (const child of ghost.querySelectorAll(
      '[id], [autofocus], [aria-live]',
    )) {
      child.removeAttribute('id');
      child.removeAttribute('autofocus');
      child.removeAttribute('aria-live');
    }
    Object.assign(ghost.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      boxSizing: 'border-box',
      pointerEvents: 'none',
    });
    ghost.popover = 'manual';
    document.body.append(ghost);
    ghost.showPopover();
    const remove = () => ghost.remove();
    ghost.addEventListener('animationend', (event) => {
      if (event.target === ghost) remove();
    });
    // Also clean up when the engine suppresses animation events.
    setTimeout(remove, 220);
  };
}
