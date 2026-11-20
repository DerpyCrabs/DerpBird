import type { createStyleController } from '../../browser/style-controller';
import type { createScriptController } from '../../browser/script-controller';
import { exportSource } from '../../browser/source-files';
import { scriptExecutionNotice } from '../../browser/script-protocol';
import template from './library.html?raw';
import './manager.css';

type Model = ReturnType<typeof createStyleController> | ReturnType<typeof createScriptController>;
type Screen = 'library' | 'folders' | 'install' | 'edit' | 'matching';
export function mountLibrary(
  root: HTMLElement,
  kind: 'styles' | 'scripts',
  model: Model,
  initial: string,
  closed: () => void,
  syncFolders = false,
) {
  const host = document.createElement('dialog');
  host.className = 'tool-library preferences-theme pref-dialog';
  host.dataset.theme = document.body.dataset.theme ?? 'dark';
  host.setAttribute('aria-labelledby', 'tool-heading');
  host.innerHTML = template;
  root.append(host);
  const get = <T extends HTMLElement = HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const field = (key: string) => get<HTMLInputElement>('[name="' + key + '"]');
  const button = (key: string) => get<HTMLButtonElement>('[data-do="' + key + '"]');
  const style = 'configure' in model ? model : undefined;
  const script = 'setFileAccess' in model ? model : undefined;
  const noun = style ? 'style' : 'script',
    title = style ? 'User styles' : 'Userscripts';
  field('name').maxLength = style ? 512 : 1024;
  field('source').maxLength = 2 * 1024 * 1024;
  const back = get<HTMLButtonElement>('.tool-back');
  back.title = 'Back to ' + title;
  back.setAttribute('aria-label', back.title);
  get('.tool-close').setAttribute('aria-label', 'Close ' + title);
  const confirmation = get<HTMLDialogElement>('.leave-confirm');
  let removingId: string | undefined;
  let returnButton: HTMLButtonElement | undefined;
  let returnItem: string | undefined;
  let editingInitialItem = false;
  let interruptedControl: HTMLElement | null = null;
  let screen: Screen = 'library',
    start = initial,
    exit: (() => void) | undefined,
    disposed = false;
  let lastItems: unknown, lastDirs: unknown, lastConfig: unknown;
  function show(next: Screen) {
    screen = next;
    host.dataset.screen = next;
    for (const el of host.querySelectorAll<HTMLElement>('[data-view]')) el.hidden = el.dataset.view !== next;
    get('h1').textContent =
      next === 'library'
        ? title
        : {
            folders: 'Source folders',
            matching: 'Page matching',
            install: 'Install ' + noun,
            edit: 'Edit ' + noun,
          }[next];
    back.hidden = next === 'library';
    get('.tool-editor-actions').hidden = next !== 'edit';
    get('.pref-scroll-body').scrollTop = 0;
    if (next !== 'edit') get<HTMLDetailsElement>('.tool-options').open = false;
    if (next === 'folders') button('add').focus();
    if (next === 'matching') button('status').focus();
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    host.close();
    host.remove();
    void model.close();
  };
  function leave(action: () => void) {
    if (model.state().busy) return false;
    if (model.state().dirty) {
      exit = action;
      if (!confirmation.open) {
        interruptedControl = document.activeElement as HTMLElement;
        confirmation.hidden = false;
        confirmation.showModal();
      }
      button('stay').focus();
      return false;
    }
    action();
    return true;
  }
  const dismiss = () =>
    leave(() => {
      dispose();
      closed();
      document.querySelector<HTMLButtonElement>(`button[aria-label="${kind === 'styles' ? 'Styles' : 'Scripts'} on this page"]`)?.focus();
    });
  const goBack = () =>
    leave(() => {
      show('library');
      const edit =
        returnItem &&
        get<HTMLButtonElement>('.tool-item[data-id="' + CSS.escape(returnItem) + '"] .tool-edit');
      (edit || returnButton || button('new')).focus();
    });
  back.onclick = goBack;
  get('.tool-close').onclick = dismiss;
  const addButton = (name: string, handler: () => void) => {
    button(name).onclick = handler;
  };
  function closeConfirmation() {
    exit = undefined;
    confirmation.close();
    confirmation.hidden = true;
    (interruptedControl?.isConnected && interruptedControl !== document.body
      ? interruptedControl
      : field('name')
    ).focus();
    interruptedControl = null;
  }
  addButton('stay', closeConfirmation);
  confirmation.oncancel = (e) => {
    e.preventDefault();
    closeConfirmation();
  };
  confirmation.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeConfirmation();
    }
  };
  addButton('leave', () => {
    const action = exit;
    closeConfirmation();
    model.discard();
    action?.();
  });
  host.addEventListener(
    'click',
    (e) => {
      const trigger = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view=library] button');
      if (trigger) {
        returnButton = trigger;
        returnItem = trigger.closest<HTMLElement>('.tool-item')?.dataset.id;
      }
    },
    true,
  );
  addButton('folders', () => {
    show('folders');
    model.folders();
  });
  addButton('add', () => model.folders('add'));
  addButton('refresh', () => model.folders());
  addButton('matching', () => {
    show('matching');
    style?.refreshStatus();
  });
  addButton('status', () => style?.refreshStatus());
  addButton('new', () => {
    model.create();
    show('edit');
    field('name').focus();
  });
  addButton('install', () => {
    show('install');
    field('url').focus();
  });
  get('form').onsubmit = (e) => {
    e.preventDefault();
    model.importURL(field('url').value);
  };
  const file = get<HTMLInputElement>('[type=file]');
  file.accept = style ? '.css,.less,.styl' : '.js';
  file.onchange = () => {
    if (file.files?.[0]) model.importFile(file.files[0]);
    file.value = '';
  };
  field('name').oninput = () => model.change({ name: field('name').value });
  field('source').oninput = () => model.change({ source: field('source').value });
  field('enabled').onchange = () => model.change({ enabled: field('enabled').checked });
  field('daily').onchange = () => model.change({ checkUpdates: field('daily').checked });
  field('local').onchange = () => script?.setFileAccess(field('local').checked);
  addButton('reload', () => model.load());
  addButton('save', () => model.save());
  addButton('discard', () => model.discard());
  addButton('export', () => {
    const d = model.state().draft;
    if (d) exportSource(d.name, d.source, style ? '.user.css' : '.user.js');
  });
  addButton('delete', () => {
    model.requestRemove();
    button('keep').focus();
  });
  addButton('keep', () => {
    model.cancelRemove();
    button('delete').focus();
  });
  addButton('remove', () => {
    removingId = model.state().draft?.id;
    model.remove();
  });
  addButton('latest', () => model.reloadLatest());
  addButton('continue', () => model.continueDraft());
  addButton('configure', () => style?.configure());
  addButton('reset-vars', () => style?.resetVariables());
  addButton('stop-download', () => model.cancelDownload());
  addButton('stop-compile', () => style?.cancelCompilation());
  addButton('review', () => model.reviewUpdate());
  addButton('update', () => {
    const url = model.state().draft?.sourceURL;
    if (url) model.importURL(url, true);
  });
  button('new').textContent = 'New ' + noun;
  button('matching').hidden = !style;
  get('.tool-code span').textContent = style ? 'CSS source' : 'JavaScript source';
  host.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && screen === 'edit') {
      e.preventDefault();
      model.save();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  function cancel() {
    if (exit) {
      button('stay').click();
      field('name').focus();
      return;
    }
    if (model.state().confirmingRemoval) {
      model.cancelRemove();
      button('delete').focus();
      return;
    }
    dismiss();
  }
  host.oncancel = (e) => {
    e.preventDefault();
    cancel();
  };
  function update() {
    const m = model.state(),
      d = m.draft,
      sm = style?.state(),
      jm = script?.state();
    if (start && m.snapshot && !m.busy) {
      const first = start;
      start = '';
      editingInitialItem = first === 'editor';
      show(editingInitialItem ? 'edit' : 'library');
    }
    if (screen === 'install' && m.dirty) {
      show('edit');
      field('name').focus();
    }
    if (removingId && !m.busy && m.snapshot) {
      if (!m.snapshot.items.some((item) => item.id === removingId)) {
        show('library');
        button('new').focus();
      }
      removingId = undefined;
    }
    if (screen === 'edit' && !d && m.snapshot) {
      show('library');
      button('new').focus();
    }
    if (m.snapshot && lastItems !== m.snapshot.items) {
      lastItems = m.snapshot.items;
      const rows = m.snapshot.items.map((item) => {
        const row = document.createElement('div');
        row.className = 'tool-item';
        row.dataset.id = item.id;
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.setAttribute('role', 'switch');
        check.checked = item.enabled;
        check.setAttribute('aria-label', 'Enable ' + item.name);
        check.onchange = () => {
          const enabled = check.checked;
          check.checked = item.enabled;
          model.setEnabled(item.id, enabled);
        };
        const edit = document.createElement('button');
        edit.className = 'tool-edit';
        const name = document.createElement('strong');
        name.textContent = item.name;
        const origin = document.createElement('small');
        origin.textContent = item.pendingUpdate
          ? 'Update available'
          : (item.sourceURL ?? (style ? 'Local style' : 'Local script'));
        edit.append(name, origin);
        edit.onclick = () => {
          model.select(item.id);
          show('edit');
          field('name').focus();
        };
        row.append(edit, check);
        return row;
      });
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.tool-item')
        ?.dataset.id;
      const switching = document.activeElement?.matches('[role=switch]');
      get('.tool-items').replaceChildren(...rows);
      if (focused)
        get<HTMLElement>(
          '.tool-item[data-id="' + CSS.escape(focused) + '"] ' + (switching ? 'input' : 'button'),
        )?.focus();
      if (!rows.length) get('.tool-items').textContent = 'No ' + kind + ' installed.';
    }
    for (const control of get('.tool-items').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'))
      control.disabled = m.busy;
    if (lastDirs !== m.directories) {
      lastDirs = m.directories;
      get('.no-folders').hidden = !!m.directories.length;
      get('.tool-dirs').replaceChildren(
        ...m.directories.map((path) => {
          const li = document.createElement('li'),
            remove = document.createElement('button');
          remove.className = 'pref-button';
          remove.textContent = 'Disconnect';
          remove.onclick = () => model.folders('remove', path);
          li.append(path, remove);
          return li;
        }),
      );
    }
    const match = sm?.matchStatus;
    get('.tool-match').textContent = match
      ? `${match.url} · ${!match.evaluated ? 'Not evaluated' : match.skippedConditions ? 'Some conditions skipped' : 'Matching completed'}`
      : '';
    const config = sm?.configuration;
    if (config !== lastConfig) {
      lastConfig = config;
      get('.tool-vars').replaceChildren(
        ...Object.values(config?.vars ?? {}).map((v) => {
          const label = document.createElement('label'),
            input = v.options ? document.createElement('select') : document.createElement('input');
          if (input instanceof HTMLSelectElement)
            for (const opt of v.options ?? []) input.add(new Option(opt.label, opt.name));
          else
            input.type =
              v.type === 'checkbox' ? 'checkbox' : ['number', 'range'].includes(v.type) ? 'number' : 'text';
          const val = sm?.draft?.usercss?.values[v.name] ?? v.default;
          input.value = String(val);
          if (input instanceof HTMLInputElement && input.type === 'checkbox')
            input.checked = Number(val) === 1;
          input.oninput = () =>
            style?.changeVariable(
              v.name,
              input instanceof HTMLInputElement && input.type === 'checkbox'
                ? Number(input.checked)
                : input.value,
            );
          input.dataset.variable = v.name;
          if (input instanceof HTMLInputElement && input.type === 'number') {
            if (v.min != null) input.min = String(v.min);
            if (v.max != null) input.max = String(v.max);
            input.step = String(v.step ?? 'any');
          }
          label.append(v.label + (v.units ? ' (' + v.units + ')' : ''), input);
          return label;
        }),
      );
    }
    if (config)
      for (const input of host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-variable]')) {
        const v = config.vars[input.dataset.variable!];
        const value = sm?.draft?.usercss?.values[v.name] ?? v.default;
        if (input instanceof HTMLInputElement && input.type === 'checkbox')
          input.checked = Number(value) === 1;
        else if (input.value !== String(value)) input.value = String(value);
        input.disabled = m.busy;
      }
    get('.tool-var-info').textContent = config
      ? [config.name, config.version, config.preprocessor].filter(Boolean).join(' · ')
      : '';
    button('configure').setAttribute('aria-expanded', String(!!config));
    for (const key of ['name', 'source'] as const)
      if (field(key).value !== (d?.[key] ?? '')) field(key).value = d?.[key] ?? '';
    field('enabled').checked = !!d?.enabled;
    field('daily').checked = !!d?.checkUpdates;
    const installed = jm?.snapshot?.items.find((i) => i.id === d?.id);
    field('local').checked = !!installed?.fileAccessGranted;
    field('local').parentElement!.hidden = !installed;
    field('local').disabled = m.busy || m.dirty;
    field('daily').parentElement!.hidden = !d?.sourceURL;
    get('.origin').textContent = d?.sourceURL ?? '';
    button('update').hidden = !d?.sourceURL;
    button('update').disabled = m.busy || m.dirty;
    button('review').hidden = !d?.pendingUpdate;
    button('configure').hidden = !style || !d?.source.includes('==UserStyle==');
    button('reset-vars').hidden = !config;
    button('stop-compile').hidden = !sm?.compiling;
    button('stop-download').hidden = !m.downloading;
    get('.review-note').textContent = [
      d?.updateError,
      m.updateReview,
      sm?.matchStatus?.styleIds.includes(d?.id ?? '')
        ? 'Some matching conditions exceeded the execution limit.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    get('.editor-notice').textContent = [
      d?.id.startsWith('folder_') ? 'Folder refresh replaces local edits.' : '',
      script ? 'Changes apply after reloading the page.' : '',
      installed && !m.dirty ? scriptExecutionNotice(installed) : '',
    ]
      .filter(Boolean)
      .join(' ');
    button('reload').hidden = !m.error && !m.conflict;
    for (const key of ['name', 'source', 'enabled', 'daily']) field(key).disabled = m.busy;
    button('review').disabled = button('update').disabled = m.busy || m.dirty;
    button('new').disabled = button('install').disabled = !m.snapshot || m.busy;
    for (const action of [
      'add',
      'refresh',
      'configure',
      'reset-vars',
      'export',
      'reload',
      'latest',
      'continue',
      'remove',
      'keep',
    ])
      button(action).disabled = m.busy;
    field('url').disabled = file.disabled = m.busy || m.dirty;
    get<HTMLButtonElement>('.tool-import button').disabled = m.busy || m.dirty;
    back.disabled = get<HTMLButtonElement>('.tool-close').disabled = m.busy;
    get('.tool-remove strong').textContent = 'Delete “' + (d?.name ?? noun) + '”?';
    get('.tool-error').textContent = m.error ?? '';
    get('.tool-remove').hidden = !m.confirmingRemoval;
    get('.tool-conflict').hidden = !m.conflict;
    get('.tool-state').textContent = m.busy ? 'Working…' : m.dirty ? 'Unsaved changes' : 'Saved';
    button('discard').hidden = !m.dirty;
    if (editingInitialItem && d) {
      field('name').focus();
      editingInitialItem = false;
    }
    button('save').disabled = button('discard').disabled = !m.dirty || m.busy || m.conflict;
    button('delete').disabled = m.dirty || m.busy || !!d?.id.startsWith('folder_');
  }
  const unsubscribe = model.source.subscribe(update);
  show('library');
  host.showModal();
  button('new').focus();
  if (syncFolders) model.folders(); else model.load();
  return { dismiss, dispose };
}
