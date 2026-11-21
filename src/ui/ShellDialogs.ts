import { mountProcessTable } from './ShellProcessTable';
import { mountValuePicker } from './ShellValuePicker';
import { mountBookmarkFields } from './ShellBookmarkFields';
import type { ShellController } from '../browser/controller';
import './preferences-primitives.css';
import './shell-dialog.css';

export function mountShellDialogs(controller: ShellController) {
  const dialog = document.createElement('dialog');
  dialog.className = 'preferences-theme pref-dialog shell-dialog';
  dialog.setAttribute('aria-labelledby', 'shell-dialog-title');
  dialog.setAttribute('aria-describedby', 'shell-dialog-message');
  dialog.innerHTML = `<form><header class="pref-dialog-heading"><h2 id="shell-dialog-title"></h2></header>
    <p class="shell-dialog-site"></p><p id="shell-dialog-message" class="pref-dialog-description"></p>
    <div class="shell-processes" hidden></div><div class="shell-bookmark-fields"></div>
    <label class="shell-hex" for="shell-response" hidden>Hex</label><input class="pref-input" aria-label="Response" hidden>
    <div class="shell-value-picker"></div><label class="shell-dialog-block" hidden><input type="checkbox"> Block further dialogs from this page</label>
    <div class="shell-permission-choices" hidden><button type="button" class="pref-button" data-once>Allow this time</button><button type="button" class="pref-button" data-always>Always allow</button><button type="button" class="pref-button" data-block>Never allow</button></div>
    <p role="alert" class="shell-dialog-error" hidden></p><footer><button type="button" class="pref-button ghost" data-remove hidden>Remove</button><button data-cancel type="button" class="pref-button"></button><button type="submit" class="pref-button primary"></button></footer></form>`;
  const title = dialog.querySelector('h2')!;
  const error = dialog.querySelector<HTMLElement>('.shell-dialog-error')!;
  const site = dialog.querySelector<HTMLElement>('.shell-dialog-site')!;
  const message = dialog.querySelector<HTMLElement>('#shell-dialog-message')!;
  const input = dialog.querySelector<HTMLInputElement>('.pref-input')!;
  input.id = 'shell-response';
  const block = dialog.querySelector<HTMLInputElement>('[type=checkbox]')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const accept = dialog.querySelector<HTMLButtonElement>('[type=submit]')!;
  const updateProcesses = mountProcessTable(dialog.querySelector<HTMLElement>('.shell-processes')!, controller);
  const bookmark = mountBookmarkFields(dialog.querySelector<HTMLElement>('.shell-bookmark-fields')!);
  const remove = dialog.querySelector<HTMLButtonElement>('[data-remove]')!;
  remove.onclick = () => controller.send({ type: 'dialog.answer', id, accepted: true, value: '{"remove":true}', block: false });
  const permission = dialog.querySelector<HTMLElement>('.shell-permission-choices')!;
  for (const choice of ['once','always','block']) {
    permission.querySelector<HTMLButtonElement>(`[data-${choice}]`)!.onclick = () =>
      controller.send({ type: 'dialog.answer', id, accepted: true, value: choice, block: false });
  }
  let id = '', previousValue = '';
  const preview = (value: string) => controller.send({ type: 'dialog.edit', id, value });
  const picker = mountValuePicker(dialog.querySelector<HTMLElement>('.shell-value-picker')!, input, preview);
  input.addEventListener('input', () => { if (controller.state().browser.dialog?.kind === 'prompt') preview(input.value); });
  function answer(accepted: boolean) {
    if (id) controller.send({ type: 'dialog.answer', id, accepted, value: bookmark.active() ? bookmark.value() : input.value, block: block.checked });
  }
  cancel.onclick = () => answer(false);
  dialog.oncancel = event => { event.preventDefault(); answer(false); };
  dialog.querySelector('form')!.onsubmit = event => { event.preventDefault(); answer(true); };
  function update() {
    const { browser, error: reason } = controller.state();
    error.hidden = !reason;
    error.textContent = reason ?? '';
    dialog.dataset.theme = browser.preferences.theme ?? 'dark';
    const d = browser.dialog;
    updateProcesses(d);
    if (!d) {
      id = '';
      if (dialog.open) dialog.close();
      return;
    }
    if (d.id === id) {
      if (previousValue !== d.value) input.value = previousValue = d.value;
      return;
    }
    id = d.id;
    bookmark.update(d);
    dialog.dataset.kind = d.kind;
    accept.hidden = d.kind === 'permission';
    permission.querySelector<HTMLButtonElement>('[data-always]')!.textContent = d.action || 'Allow';
    remove.hidden = !d.removable;
    permission.hidden = d.kind !== 'permission';
    permission.querySelector<HTMLButtonElement>('[data-once]')!.hidden = !d.once;
    const closing = d.kind === 'window-close', leaving = d.kind === 'leave';
    title.textContent = closing ? 'Close this window?' : leaving ? 'Leave this page?' : d.title;
    site.textContent = closing || leaving ? d.title : '';
    site.hidden = !site.textContent;
    message.textContent = d.message;
    const dateKind = ['date','datetime-local','time','week','month'].includes(d.kind);
    input.type = dateKind ? d.kind : 'text';
    dialog.querySelector<HTMLElement>('.shell-hex')!.hidden = d.kind !== 'color';
    input.setAttribute('aria-label', d.kind === 'color' ? 'Hex color' : 'Response');
    input.min = d.minimum ?? '';
    input.max = d.maximum ?? '';
    input.step = 'any';
    input.hidden = d.kind !== 'prompt' && d.kind !== 'color' && !dateKind;
    if (d.kind === 'color') input.pattern = '#[a-fA-F0-9]{6}';
    else input.removeAttribute('pattern');
    input.disabled = input.hidden;
    input.value = previousValue = d.value;
    picker(d);
    block.checked = false;
    block.parentElement!.hidden = !d.offerBlock;
    cancel.hidden = d.kind === 'alert' || d.kind === 'processes';
    cancel.textContent = closing || leaving ? 'Keep editing' : 'Cancel';
    accept.textContent = d.action || (d.kind === 'processes' ? 'Done' : closing ? 'Close window' : leaving ? 'Leave page' : 'OK');
    if (!dialog.open) dialog.showModal();
    if (bookmark.active()) bookmark.focus();
    else if (!input.hidden) { input.focus(); if (d.kind === 'prompt') input.select(); }
    else if (closing || leaving || d.kind === 'external' || d.kind === 'downloads' || d.kind.startsWith('permission')) cancel.focus();
    else accept.focus();
  }
  document.body.append(dialog);
  const stop = controller.source.subscribe(update);
  update();
  return () => { stop(); dialog.remove(); };
}
