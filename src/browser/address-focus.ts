import type { ShellController } from './controller';
/** One focus path for the native shortcut, shell shortcut and demos. */
export function focusAddress(document: Document, controller: ShellController) {
  if (controller.state().chromeLayout?.preset === 'compact') {
    if (!controller.state().addressPaletteOpen) controller.openAddressPalette();
    // Repeated Ctrl+L selects the draft instead of replacing it with the page URL.
    const input = document.querySelector<HTMLInputElement>('#palette-location');
    input?.focus();
    input?.select();
  } else {
    const input = document.querySelector<HTMLInputElement>('#location');
    input?.focus();
    input?.select();
  }
}
