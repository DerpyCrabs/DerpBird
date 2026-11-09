// The shell and web page are separate native views. A page click does not
// bubble through this document: it deactivates the shell instead.
type DismissalObserver = {
  deactivate?: () => void;
};
let active = true;
let keyboard = false;
const setInputMethod = (fromKeyboard: boolean) => {
  keyboard = fromKeyboard;
  document.documentElement.dataset.inputMethod = keyboard ? 'keyboard' : 'pointer';
};
const onKey = (event: KeyboardEvent) => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  active = true;
  setInputMethod(true);
};
const onKeyboardFocus = () => { active = true; setInputMethod(true); };
const onFocus = () => { active = true; };
// Opening a surface may focus its first control, but delayed work must never
// reclaim focus after the user has moved into the page or another window.
export function focusShellElement(target: HTMLElement | null | undefined) {
  if (active && target?.isConnected) target.focus();
}
export const shouldRestoreShellFocus = () => active && keyboard;
const observers = new Set<DismissalObserver>();
const onPointer = (event: PointerEvent) => {
  active = true;
  setInputMethod(false);
};
const onDeactivate = () => {
  // The native pre-deactivation and subsequent window blur are one transition.
  // Clearing DOM focus can itself dispatch blur, so mark inactive first.
  if (!active) return;
  active = false;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  for (const observer of [...observers]) observer.deactivate?.();
};
export function observeShellDismissal(observer: DismissalObserver): () => void {
  if (!observers.size) {
    setInputMethod(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('derpbird-shell-keyboard-focus', onKeyboardFocus);
    window.addEventListener('derpbird-shell-deactivate', onDeactivate);
    window.addEventListener('blur', onDeactivate);
  }
  observers.add(observer);
  return () => {
    observers.delete(observer);
    if (!observers.size) {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('derpbird-shell-keyboard-focus', onKeyboardFocus);
      window.removeEventListener('derpbird-shell-deactivate', onDeactivate);
      window.removeEventListener('blur', onDeactivate);
    }
  };
}
