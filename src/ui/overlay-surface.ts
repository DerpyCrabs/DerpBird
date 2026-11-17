import { domBinding } from 'effectweb';
import { observeOverlayMotion } from './overlay-motion';
import { observePopupPosition } from './overlay-position';

function acquireSurface(element: HTMLElement) {
  const stopPosition =
    element.tagName === 'DIALOG' ? () => {} : observePopupPosition(element);
  const stopMotion = observeOverlayMotion(element);
  return () => {
    stopPosition();
    stopMotion();
  };
}

export const overlaySurface = (kind: 'popover' | 'menu' | 'dialog') =>
  domBinding(kind, acquireSurface);
