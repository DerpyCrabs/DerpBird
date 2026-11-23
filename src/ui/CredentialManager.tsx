import template from './preferences/passwords.html?raw';
import './preferences/manager.css';
import './preferences/passwords.css';
import { createCredentialController } from '../browser/credential-controller';
import type { CapturedCredential, CredentialPort } from '../browser/credential-protocol';

export function openCredentialManager(
  root: HTMLElement,
  port: CredentialPort,
  closed: () => void,
  proposal?: CapturedCredential,
) {
  const model = createCredentialController(port);
  const host = document.createElement('dialog');
  host.className = 'tool-library preferences-theme pref-dialog password-library';
  host.dataset.theme = document.body.dataset.theme ?? 'dark';
  host.dataset.screen = 'library';
  host.setAttribute('aria-labelledby', 'tool-heading');
  host.innerHTML = template;
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const btn = (action: string) => el<HTMLButtonElement>('[data-do="' + action + '"]');
  el('.tool-back').setAttribute('aria-label', 'Back to passwords');
  el('.tool-close').setAttribute('aria-label', 'Close passwords');
  const search = el<HTMLInputElement>('[type=search]');
  const field = (name: string) => el<HTMLInputElement>('[name="' + name + '"]');
  const confirm = el<HTMLDialogElement>('.leave-confirm');
  let leaving: (() => void) | undefined;
  function update() {
    const m = model.state();
    if (m.proposal) host.dataset.screen = 'capture';
    else if (host.dataset.screen === 'capture' || (!m.draft && !m.busy)) host.dataset.screen = 'library';
    const edit = host.dataset.screen === 'edit';
    for (const node of host.querySelectorAll<HTMLElement>('[data-view]'))
      node.hidden = node.dataset.view !== host.dataset.screen;
    el('.tool-editor-actions').hidden = el('.tool-back').hidden = !edit;
    el('h1').textContent = edit ? (m.draft?.id ? 'Edit password' : 'Add password') : 'Passwords';
    el('.tool-error').textContent = m.error ?? '';
    btn('reload').hidden = !m.error && !el<HTMLDetailsElement>('.credential-exceptions').open;
    btn('reload').disabled = m.busy || m.dirty;
    btn('new').disabled = !m.items || m.busy;
    if (!edit) {
      field('password').value = '';
      field('password').type = 'password';
    }
    if (m.proposal) {
      const capture = m.proposal;
      el('h1').textContent = 'Save this login?';
      el('.capture-site').textContent = capture.origin;
      el('.capture-user').textContent = capture.username || 'No username';
      el('.capture-targets').replaceChildren(
        ...(m.items ?? [])
          .filter((item) => item.origin === capture.origin && item.username === capture.username)
          .map((item) => {
            const button = document.createElement('button');
            button.className = 'pref-button';
            button.textContent = 'Update password for ' + (item.username || 'unnamed login');
            button.disabled = m.busy;
            button.onclick = () => model.saveCapture(item.id);
            return button;
          }),
      );
      btn('never').hidden = !port.exceptions;
      btn('save-capture').disabled = m.busy || !m.items;
      return;
    }
    if (!edit) {
      const matches = (m.items ?? []).filter((i) =>
        (i.origin + ' ' + i.username).toLowerCase().includes(search.value.toLowerCase()),
      );
      el('.tool-items').replaceChildren(
        ...matches.slice(0, 100).map((item) => {
          const row = document.createElement('div');
          row.className = 'tool-item';
          row.innerHTML = '<button class="tool-edit"><strong></strong><small></small></button>';
          row.querySelector('strong')!.textContent = item.origin.startsWith('http://')
            ? item.origin
            : new URL(item.origin).host;
          row.querySelector('small')!.textContent = item.username || 'No username';
          row.querySelector('button')!.disabled = m.busy;
          row.querySelector('button')!.onclick = () => {
            model.select(item.id);
            editor();
          };
          return row;
        }),
      );
      el('.no-results').textContent = matches.length || m.busy ? '' : 'No passwords found.';
      if (matches.length > 100)
        el('.no-results').textContent = 'Showing the first 100 logins. Refine your search.';
      el('.credential-exceptions').hidden =
        !port.exceptions || (!m.exceptions.length && !el<HTMLDetailsElement>('.credential-exceptions').open);
      el('.credential-exceptions summary').textContent = 'Never save (' + m.exceptions.length + ')';
      const exceptions = m.exceptions.filter((origin) =>
        origin.toLowerCase().includes(search.value.toLowerCase()),
      );
      el('.exception-list').replaceChildren(
        ...exceptions.slice(0, 100).map((origin) => {
          const row = document.createElement('div');
          const button = document.createElement('button');
          button.className = 'pref-button';
          button.textContent = 'Allow';
          button.setAttribute('aria-label', 'Allow prompts for ' + origin);
          button.disabled = m.busy;
          button.onclick = () => model.allowOrigin(origin);
          row.append(origin, button);
          return row;
        }),
      );
      return;
    }
    if (!m.draft) return;
    for (const key of ['origin', 'username', 'password'] as const) {
      const value = key === 'password' ? (m.revealed ?? m.draft.password) : m.draft[key];
      if (field(key).value !== value) field(key).value = value;
    }
    for (const key of ['origin', 'username', 'password']) field(key).disabled = m.busy;
    field('password').readOnly = m.revealed !== null;
    btn('capture').hidden = !port.capture || !!m.draft.id;
    btn('capture').disabled = m.busy || !!(m.draft.origin || m.draft.username || m.draft.password);
    btn('fill').hidden = !port.fill || !m.draft.id;
    btn('fill').disabled = m.busy || m.dirty;
    field('origin').readOnly = !!m.draft.id;
    field('password').type = m.revealed === null ? 'password' : 'text';
    field('password').placeholder = m.draft.id ? '••••••••' : '';
    el('.password-label').textContent = 'Password';
    btn('reveal').textContent = m.revealed === null ? 'Show' : 'Hide';
    btn('copy').hidden = btn('delete').hidden = btn('reveal').hidden = !m.draft.id;
    btn('copy').disabled = btn('reveal').disabled = btn('delete').disabled = m.busy || m.dirty;
    btn('save').disabled = m.busy || !m.dirty;
    el('.tool-state').textContent = m.copied ? 'Password copied' : m.filled ? 'Login filled' : '';
    el('.tool-remove').hidden = !m.confirmingRemoval;
  }
  function editor() {
    host.dataset.screen = 'edit';
    update();
    field(model.state().draft?.id ? 'username' : 'origin').focus();
  }
  function leave(action: () => void) {
    if (model.state().busy) return;
    if (!model.state().dirty) {
      action();
      return;
    }
    leaving = action;
    confirm.hidden = false;
    confirm.showModal();
    btn('stay').focus();
  }
  function back() {
    model.hide();
    model.cancelRemove();
    host.dataset.screen = 'library';
    update();
    search.focus();
  }
  function onVisibility() {
    if (document.hidden) model.hide();
  }
  function escape() {
    if (model.state().revealed !== null) model.hide();
    else if (model.state().proposal) model.discardCapture();
    else if (model.state().confirmingRemoval) model.cancelRemove();
    else leave(host.dataset.screen === 'edit' ? back : dispose);
  }
  function keydown(event: KeyboardEvent) {
    if (confirm.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      escape();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (host.dataset.screen === 'edit') model.save();
    }
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', model.hide);
    host.close();
    host.remove();
    document.querySelector<HTMLButtonElement>('button[aria-label=Menu]')?.focus();
    void model.close();
    closed();
  }
  el('.tool-back').onclick = () => leave(back);
  el('.tool-close').onclick = () => {
    if (model.state().proposal) model.discardCapture();
    else leave(dispose);
  };
  host.oncancel = (event) => {
    event.preventDefault();
    escape();
  };
  btn('stay').onclick = () => {
    confirm.close();
    confirm.hidden = true;
    leaving = undefined;
  };
  confirm.oncancel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    btn('stay').click();
  };
  btn('leave').onclick = () => {
    const action = leaving;
    btn('stay').click();
    model.discard();
    action?.();
  };
  search.oninput = update;
  btn('new').onclick = () => {
    model.create();
    editor();
  };
  for (const key of ['origin', 'username', 'password'] as const)
    field(key).oninput = () => model.change({ [key]: field(key).value });
  btn('capture').onclick = () => {
    model.discard();
    model.capture();
  };
  btn('fill').onclick = model.fill;
  btn('reload').onclick = () => model.load();
  el('.credential-exceptions').ontoggle = update;
  btn('never').onclick = model.neverCapture;
  btn('cancel-capture').onclick = model.discardCapture;
  btn('save-capture').onclick = () => model.saveCapture(null);
  btn('generate').onclick = model.generate;
  btn('save').onclick = model.save;
  btn('copy').onclick = model.copy;
  btn('reveal').onclick = () => (model.state().revealed === null ? model.reveal() : model.hide());
  btn('delete').onclick = model.requestRemove;
  btn('keep').onclick = model.cancelRemove;
  btn('remove').onclick = model.remove;
  const unsubscribe = model.source.subscribe(update);
  window.addEventListener('blur', model.hide);
  document.addEventListener('keydown', keydown);
  document.addEventListener('visibilitychange', onVisibility);
  root.append(host);
  update();
  host.showModal();
  model.load(proposal);
  return { dispose };
}
