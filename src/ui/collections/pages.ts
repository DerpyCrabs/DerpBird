import { collectionDialog } from './dialogs';
import { mountBookmarkActions } from './bookmark-actions';
import primitives from '../preferences-primitives.css?inline';
import tabRows from '../design/tab-row.css?inline';
import branches from '../design/tree-branches.css?inline';
import skin from './pages.css?inline';

function mountBookmarkNavigation(doc: Document) {
  const nav = doc.querySelector('#folders')!;
  const select = doc.createElement('select');
  select.className = 'pref-input';
  select.setAttribute('aria-label', 'Bookmark folder');
  const header = doc.querySelector('main header')!;
  const createFolder = doc.getElementById('new-folder-button')!;
  const options = doc.getElementById('menu-dropdown')!;
  const compact = doc.defaultView!.matchMedia('(max-width: 700px)');
  function positionCreateFolder() {
    createFolder.className = compact.matches ? 'menu-item' : 'secondary-button';
    if (compact.matches) options.prepend(createFolder);
    else header.insertBefore(createFolder, header.querySelector('.header-menu'));
  }
  createFolder.addEventListener('click', () => options.classList.add('hidden'));
  compact.addEventListener('change', positionCreateFolder);
  positionCreateFolder();
  header.append(select);
  const syncFolders = () => {
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('.folder-link')];
    // The native renderer emits a flat, depth-first list. Mark the last sibling
    // at each level so the shared tab branch ends at the correct row.
    const levels = links.map(link => Number(link.style.getPropertyValue('--folder-depth')));
    const following: number[] = [];
    for (let i = links.length - 1; i >= 0; i--) {
      const depth = levels[i];
      while (following.length && following[following.length - 1] > depth) following.pop();
      const sibling = following[following.length - 1] === depth;
      links[i].toggleAttribute('data-branch', depth > 0);
      links[i].dataset.groupEnd = String(!sibling);
      if (!sibling) following.push(depth);
    }
    const parents: HTMLAnchorElement[] = [];
    for (const [i, link] of links.entries()) {
      const depth = levels[i];
      parents.length = depth;
      for (let level = 1; level < depth; level++) {
        if (parents[level].dataset.groupEnd === 'true') continue;
        const guide = doc.createElement('span');
        guide.className = 'folder-ancestor-guide';
        guide.setAttribute('aria-hidden', 'true');
        guide.style.setProperty('--levels-up', String(depth - level));
        link.append(guide);
      }
      parents.push(link);
    }
    select.replaceChildren(
      ...links.map(
        (link, i) =>
          new Option(
            link.querySelector('.name')!.textContent!,
            String(i),
            false,
            link.hasAttribute('aria-current'),
          ),
      ),
    );
    if (!links.some(link => link.hasAttribute('aria-current'))) {
      const results = new Option('Search results', '', true, true);
      results.disabled = true;
      select.add(results, 0);
    }
    select.onchange = () => links[Number(select.value)]?.click();
  };
  new MutationObserver((changes) => {
    if (changes.some((c) => [...c.addedNodes, ...c.removedNodes].some((n) => n.nodeName === 'A')))
      syncFolders();
  }).observe(nav, { childList: true });
  syncFolders();
}

export function mountCollectionUI(doc: Document, page: string) {
  doc.body.classList.add("preferences-theme", page);
  const style = doc.createElement("style");
  style.textContent = [primitives, branches, skin, tabRows].join("\n");
  doc.head.append(style);
  if (page === 'bookmarks') {
    mountBookmarkNavigation(doc);
    mountBookmarkActions(doc);
  } else {
    Object.assign(doc.defaultView!, {
      confirmHistoryChange: (text: string) =>
        new Promise<boolean>((resolve) => {
          const dialog = collectionDialog(doc, text);
          const footer = doc.createElement('footer');
          for (const [label, value] of [
            ['Cancel', 'cancel'],
            [text.startsWith('Forget') ? 'Forget site' : 'Remove', 'confirm'],
          ]) {
            const btn = doc.createElement('button');
            btn.className = 'pref-button';
            btn.textContent = label;
            btn.onclick = () => dialog.close(value);
            footer.append(btn);
          }
          dialog.append(footer);
          dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
          dialog.showModal();
        }),
    });

  }
  const search = doc.querySelector<HTMLInputElement>('.search-field input, .search-container input')!;
  const field = search.closest('label')!;
  const searchButton = doc.createElement('button');
  searchButton.className = 'collection-search-toggle pref-icon-button';
  searchButton.setAttribute('aria-label', search.placeholder);
  searchButton.setAttribute('aria-controls', search.id);
  searchButton.setAttribute('aria-expanded', 'false');
  searchButton.append(field.querySelector('svg')!.cloneNode(true));
  field.before(searchButton);
  function showSearch(show: boolean) {
    field.parentElement!.classList.toggle('searching', show);
    searchButton.setAttribute('aria-expanded', String(show));
    if (show) search.focus();
    else {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      searchButton.focus();
    }
  }
  searchButton.onclick = () => showSearch(searchButton.getAttribute('aria-expanded') !== 'true');
  search.onkeydown = e => {
    if (e.key === 'Escape' && searchButton.getAttribute('aria-expanded') === 'true') showSearch(false);
  };
  // Move keyboard focus with the native row and header menus.
  new MutationObserver((records) => {
    for (const record of records) {
      const menu = record.target as HTMLElement;
      if (!menu.matches('.menu-dropdown:not(.context-actions)')) continue;
      const toggle = menu.parentElement!.querySelector<HTMLButtonElement>('.menu-toggle')!;
      const open = !menu.classList.contains('hidden');
      toggle.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector<HTMLButtonElement>('button:not(.hidden)')?.focus();
      else if (menu.contains(doc.activeElement)) toggle.focus();
    }
  }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  doc.addEventListener(
    'keydown',
    (event) => {
      const menu = (event.target as Element).closest<HTMLElement>('.menu-dropdown:not(.context-actions)');
      if (!menu) return;
      const toggle = menu.parentElement!.querySelector<HTMLButtonElement>('.menu-toggle')!;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggle.click();
        toggle.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(.hidden)')];
        const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    },
    true,
  );
}
