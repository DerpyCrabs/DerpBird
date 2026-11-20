import palette from '../../../vendor/ladybird/Base/res/ladybird/ladybird.css?raw';
import primitives from '../preferences-primitives.css?inline';
import layout from '../design/settings.css?inline';
import study from './study.css?inline';
import controls from './shared-controls.css?inline';
import type { Command, ShellPreferences } from '../../browser/protocol';
import type { Workspaces } from '../../browser/workspaces';

const get = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

export interface SettingsShell {
  state(): {browser: {preferences: ShellPreferences; workspaces?: Workspaces}; wrapTabs: boolean; sidebarWidth: number};
  source: {subscribe(callback: () => void): () => void};
  send(command: Command): void;
  switchWorkspace(id: string): void;
  setWrapTabs(value: boolean): void;
  setSidebarWidth(width: number): void;
}

export function bindShellSettings(shell: SettingsShell) {
  const activeWorkspace = () => {
    const spaces = shell.state().browser.workspaces!;
    return spaces.items.find((space) => space.id === spaces.active)!;
  };
  let workspaceKey = '';
  function syncShell() {
    const current = shell.state(),
      spaces = current.browser.workspaces!;
    get<HTMLInputElement>('#always-close').checked = current.browser.preferences.alwaysClose !== false;
    get<HTMLInputElement>('#wrap-tabs').checked = current.wrapTabs;
    get<HTMLSelectElement>('#sidebar-width').value = String(current.sidebarWidth);
    const key = JSON.stringify(spaces);
    if (key === workspaceKey) return;
    workspaceKey = key;
    get('#current-workspace').textContent = activeWorkspace().name;
    const previous = document.activeElement?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId;
    get('#workspace-list').replaceChildren(
      ...spaces.items.map((space) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.workspaceId = space.id;
        button.className = 'pref-button ghost';
        button.textContent = space.name;
        button.setAttribute('aria-pressed', String(space.id === spaces.active));
        if (space.id === spaces.active) {
          const status = document.createElement('span');
          status.textContent = 'Current';
          button.append(status);
        }
        button.onclick = () => shell.switchWorkspace(space.id);
        return button;
      }),
    );
    if (previous) get('#workspace-list [data-workspace-id="' + CSS.escape(previous) + '"]')?.focus();
  }
  syncShell();
  const stopShell = shell.source.subscribe(syncShell);
  window.addEventListener('pagehide', stopShell, { once: true });
  get<HTMLInputElement>('#always-close').onchange = (event) =>
    shell.send({
      type: 'shell.set-always-close',
      alwaysClose: (event.currentTarget as HTMLInputElement).checked,
    });
  get<HTMLInputElement>('#wrap-tabs').onchange = (event) =>
    shell.setWrapTabs((event.currentTarget as HTMLInputElement).checked);
  get<HTMLSelectElement>('#sidebar-width').onchange = (event) =>
    shell.setSidebarWidth(Number((event.currentTarget as HTMLSelectElement).value));
  const workspaceDialog = get<HTMLDialogElement>('#workspace-dialog');
  document.body.append(workspaceDialog);
  const workspaceName = get<HTMLInputElement>('#workspace-name');
  function workspaceError(invalid: boolean) {
    workspaceName.setAttribute('aria-invalid', String(invalid));
    get('#workspace-error').hidden = !invalid;
    workspaceName.setAttribute(
      'aria-describedby',
      invalid ? 'workspace-error workspace-hint' : 'workspace-hint',
    );
  }
  get('#rename-workspace').onclick = () => {
    workspaceError(false);
    workspaceName.value = activeWorkspace().name;
    workspaceDialog.showModal();
    workspaceName.focus();
    workspaceName.select();
  };
  get('#workspace-cancel').onclick = get('#workspace-dialog .close-button').onclick = () =>
    workspaceDialog.close();
  workspaceDialog.onclose = () => get('#rename-workspace').focus();
  get('form#workspace-form').onsubmit = (event) => {
    event.preventDefault();
    const name = workspaceName.value.trim();
    if (!name) {
      workspaceError(true);
      workspaceName.focus();
      return;
    }
    const { id, icon, color } = activeWorkspace();
    shell.send({ type: 'workspace.update', id, name, icon, color });
    workspaceDialog.close();
  };
  workspaceName.oninput = () => workspaceError(false);
}

export function mountSettingsPage() {
  const sheet = document.createElement('style');
  sheet.textContent = [primitives, layout, study, controls].join('\n');
  document.head.append(sheet);
  for (const [tab, template] of [
    ['tabs', 'tab-controls'],
    ['workspaces', 'workspace-controls'],
  ])
    get('#tab-' + tab).append(get<HTMLTemplateElement>('#' + template).content.cloneNode(true));
  get('#layouts').append(get('#tab-layout-group'), get('#vertical-tabs-expand-on-hover').parentElement!);
  // Preserve native IDs and event handlers while grouping the controls by what they affect.
  const appearance = get('#tab-appearance');
  const browserCard = get('#tab-appearance .card');
  const browserHeading = document.createElement('h3');
  browserHeading.className = 'card-title';
  browserHeading.textContent = 'Browser';
  appearance.insertBefore(browserHeading, browserCard);
  const pageHeading = document.createElement('h3');
  pageHeading.className = 'card-title';
  pageHeading.textContent = 'Web pages';
  const pageCard = document.createElement('div');
  pageCard.className = 'card';
  const pageBody = document.createElement('div');
  pageBody.className = 'card-body';
  for (const id of ['website-color-scheme', 'enable-force-dark', 'default-zoom-level'])
    pageBody.append(get('#' + id).closest('.card-group')!);
  pageCard.append(pageBody);
  appearance.append(pageHeading, pageCard);
  
  // Keep Ladybird's real radio controls, including the system setting, in the chrome's theme previews.
  const themePicker = get('#interface-theme');
  themePicker.className = 'theme-choices';
  for (const label of themePicker.querySelectorAll('label')) {
    const mode = label.querySelector('input')!.value;
    const preview = document.createElement('span');
    preview.className = 'haz-theme-preview theme-' + mode;
    preview.setAttribute('aria-hidden', 'true');
    preview.append(...Array.from({ length: 3 }, () => document.createElement('i')));
    label.prepend(preview);
  }
  
  for (const panel of document.querySelectorAll<HTMLElement>('.tab-panel')) {
    const heading = document.createElement('h2');
    heading.className = 'panel-heading';
    heading.textContent = panel.dataset.title!;
    panel.prepend(heading);
  }
  // Ladybird's hash-linked dialogs can close after their original button has disappeared.
  let dialogTrigger: HTMLButtonElement | null = null;
  document.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element).closest('button');
      if (button && !button.closest('dialog')) dialogTrigger = button;
    },
    true,
  );
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('close', () => {
      if (document.querySelector('dialog:modal')) return;
      const trigger = dialogTrigger;
      if (!trigger) return;
      const fallback = trigger
        .closest('.card-group')
        ?.querySelector<HTMLElement>('select,input:not([disabled])');
      const target = trigger.getClientRects().length && !trigger.disabled ? trigger : fallback;
      target?.focus();
    });
    dialog.classList.add('pref-dialog');
    const body = document.createElement('div');
    body.className = 'pref-scroll-body';
    const header = dialog.querySelector('.dialog-header')!;
    for (const child of [...dialog.children])
      if (child !== header && !child.matches('.dialog-footer')) body.append(child);
    header.after(body);
    const heading = dialog.querySelector<HTMLElement>('.dialog-title');
    if (heading) {
      heading.id ||= dialog.id + '-heading';
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    const close = dialog.querySelector<HTMLButtonElement>('.close-button');
    if (close) {
      close.classList.add('pref-icon-button');
      close.setAttribute('aria-label', 'Close dialog');
      close.innerHTML =
        '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    }
  }
  for (const button of document.querySelectorAll(
    'button:is(.primary-button,.secondary-button,.link-button),#workspace-form button',
  )) {
    button.classList.add('pref-button');
    if (button.matches('.primary-button')) button.classList.add('primary');
    if (button.matches('.link-button')) button.classList.add('ghost');
  }
  const filterLists = get('#content-blocker-lists');
  filterLists.before(get('#add-filter-list-form'));
  for (const [id, title] of [
    ['site-settings-input', 'Site'],
    ['site-settings-decision', 'Policy'],
    ['languages-select', 'Language'],
    ['custom-content-blocker-subscription-url', 'Filter list URL'],
  ]) {
    const field = get('#' + id),
      label = document.createElement('label');
    label.className = 'entry-field';
    label.htmlFor = id;
    label.textContent = title;
    field.before(label);
    label.append(field);
  }
  get('#config-filter').setAttribute('aria-label', 'Filter configuration keys');
  for (const group of document.querySelectorAll('#search-dialog .form-group')) {
    const help = group.querySelector<HTMLElement>('.description');
    const input = group.querySelector('input');
    if (help && input) {
      help.id = input.id + '-hint';
      input.after(help);
      input.setAttribute('aria-describedby', help.id);
    }
  }
  const compact = document.createElement('select');
  compact.className = 'compact-nav';
  compact.setAttribute('aria-label', 'Settings category');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab-button')];
  for (const tab of tabs) {
    compact.add(new Option(tab.textContent!.trim(), tab.dataset.tab));
    tab.addEventListener('click', () => {
      compact.value = tab.dataset.tab!;
      // A long previous panel can leave the next category's heading above the viewport.
      queueMicrotask(() => window.scrollTo(0, 0));
    });
  }
  get('.settings-sidebar').append(compact);
  const searchField = get('.settings-sidebar .search-field');
  const searchInput = get<HTMLInputElement>('#settings-search');
  const searchToggle = document.createElement('button');
  searchToggle.className = 'compact-search pref-icon-button';
  searchToggle.setAttribute('aria-label', 'Search settings');
  searchToggle.setAttribute('aria-controls', searchInput.id);
  searchToggle.setAttribute('aria-expanded', 'false');
  searchToggle.append(searchField.querySelector('svg')!.cloneNode(true));
  searchField.after(searchToggle);
  function toggleCompactSearch(open: boolean) {
    searchField.parentElement!.classList.toggle('search-open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) searchInput.focus();
    else {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles:true }));
      searchToggle.focus();
    }
  }
  searchToggle.onclick = () => toggleCompactSearch(searchToggle.getAttribute('aria-expanded') !== 'true');
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchToggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      toggleCompactSearch(false);
    }
  });
  
  get('.tab-bar').setAttribute('aria-orientation', 'vertical');
  get('.tab-bar').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
  compact.onchange = () => tabs.find((tab) => tab.dataset.tab === compact.value)?.click();
  compact.value = location.hash.slice(1) || 'appearance';
  get('#interface-theme').previousElementSibling!.textContent = 'Browser theme';
  get('#interface-theme').setAttribute('aria-label', 'Browser theme');
  const skin = document.createElement('style');
  document.head.prepend(skin);
  function syncTheme(theme: string) {
    document.body.dataset.theme =
      theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    skin.textContent =
      theme === 'system'
        ? ''
        : palette
            .replaceAll('@media (prefers-color-scheme: ' + theme + ')', '@media all')
            .replace(/@media \(prefers-color-scheme: (dark|light)\)/g, '@media not all');
    // The variable declarations must follow the base palette and precede the study overrides.
    document.querySelector('link[href$="ladybird.css"]')?.after(skin);
    document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
  }
  // A helper belongs in the field column. Preserve the native controls and their event handlers.
  let helpCount = 0;
  function alignHelp(row: Element) {
    const label = row.firstElementChild;
    if (!label?.matches('label,span')) return;
    const help = label.querySelector<HTMLElement>('.description');
    if (!help) return;
    help.id ||= 'pref-help-' + ++helpCount;
    for (const control of row.querySelectorAll('input,select,[role=radiogroup]')) {
      const ids = new Set((control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      ids.add(help.id);
      control.setAttribute('aria-describedby', [...ids].join(' '));
    }
    row.append(help);
    help.classList.add('aligned-help');
  }
  document.querySelectorAll('.inline-container').forEach(alignHelp);
  const configuration = get('#config-list');
  configuration.classList.add('card-body');
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element && node.matches('.config-row')) alignHelp(node);
  }).observe(configuration, { childList: true });
  // Provide an inline explanation for native fields that signal errors using a border.
  const messages: Record<string, string> = {
    'new-tab-page-url': 'Enter a valid URL, such as https://example.com.',
    'search-custom-name': 'Give this search engine a name.',
    'search-custom-url': 'Enter a search URL with %s in place of the query.',
    'search-custom-suggestions-url': 'Use an HTTP or HTTPS URL containing %s.',
  };
  for (const [id, message] of Object.entries(messages)) {
    const field = get<HTMLInputElement>('#' + id),
      error = document.createElement('small');
    error.id = id + '-error';
    error.className = 'field-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    error.hidden = true;
    (field.closest('.input-with-reset') ?? field).after(error);
    const sync = () => {
      const invalid = field.classList.contains('error');
      error.hidden = !invalid;
      field.setAttribute('aria-invalid', String(invalid));
      if (invalid) {
        error.textContent =
          id === 'search-custom-name' && field.value.trim()
            ? 'A search engine already uses this name.'
            : message;
        field.setAttribute('aria-errormessage', error.id);
        if (document.activeElement?.id === 'search-custom-add') field.focus();
      } else field.removeAttribute('aria-errormessage');
    };
    new MutationObserver(sync).observe(field, { attributes: true, attributeFilter: ['class'] });
  }

  function themeChanged(theme: string, color: string) {
    syncTheme(theme);
    const selected = document.querySelector<HTMLInputElement>('#color-theme input:checked');
    document.documentElement.style.setProperty('--choice', color === 'neutral' ? 'var(--text)' : selected?.parentElement?.style.getPropertyValue('--swatch') || 'var(--text)');
  }
  document.addEventListener('WebUIMessage', event => {
    const { name, data } = (event as CustomEvent).detail;
    if (name === 'loadSettings' && data.appearance) themeChanged(data.appearance.interfaceTheme ?? 'system', data.appearance.colorTheme ?? 'neutral');
  });
}
