import { collectionDialog, type Bookmark } from './dialogs';

type Target = { id?: string; targetFolderId?: string; parentFolderId?: string; clientX?: number; clientY?: number };

export function mountBookmarkActions(doc: Document) {
  let root: Bookmark[] = [];
  const send = (name: string, data: unknown) => doc.defaultView!.ladybird!.sendMessage(name, data);
  function find(id?: string, items = root): Bookmark | undefined {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const result = find(id, item.children);
        if (result) return result;
      }
    }
  }
  function edit(type: Bookmark['type'], folderId?: string, item?: Bookmark) {
    const dialog = collectionDialog(doc, (item ? 'Edit ' : 'New ') + type);
    const form = doc.createElement('form');
    form.innerHTML =
      '<label>Name<input class="pref-input" name="title" required></label><label>URL<input class="pref-input" name="url" type="url"></label><label>Folder<select name="folder" class="pref-input"></select></label><footer><button type="button" class="pref-button">Cancel</button><button type="submit" class="pref-button primary">Save</button></footer>';
    const title = form.elements.namedItem('title') as HTMLInputElement;
    const url = form.elements.namedItem('url') as HTMLInputElement;
    const folders = form.elements.namedItem('folder') as HTMLSelectElement;
    title.value = item?.title ?? '';
    url.value = item?.url ?? '';
    url.required = type === 'bookmark';
    url.parentElement!.hidden = type === 'folder';
    folders.add(new Option('Bookmarks bar', ''));
    function appendFolders(items: Bookmark[], prefix = '') {
      for (const folder of items)
        if (folder.children && folder !== item) {
          folders.add(new Option(prefix + folder.title, folder.id));
          appendFolders(folder.children, prefix + folder.title + ' / ');
        }
    }
    appendFolders(root);
    folders.value = folderId ?? '';
    form.querySelector('button')!.onclick = () => dialog.close();
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!title.value.trim()) {
        title.focus();
        return;
      }
      send('saveBookmark', { id: item?.id, type, title: title.value.trim(), url: url.value, targetFolderId: folders.value || undefined, move: !!item && (folderId ?? '') !== folders.value });
      dialog.close();
    };
    dialog.append(form);
    dialog.showModal();
    title.focus();
    title.select();
  }
  let menu: HTMLElement | null = null;
  let barMode = 'Never';
  let isPrivate = false;
  let barAvailable = true;
  function closeMenu() {
    menu?.remove();
    menu = null;
  }
  doc.addEventListener('pointerdown', (event) => {
    if (!menu?.contains(event.target as Node)) closeMenu();
  });
  function context(target: Target & { parentFolderId?: string }) {
    closeMenu();
    const trigger = doc.activeElement as HTMLElement | null;
    const item = find(target.id);
    menu = doc.createElement('div');
    menu.className = 'menu-dropdown context-actions';
    menu.setAttribute('role', 'menu');
    const actions: [string, () => void][] = [];
    const osAction = (action: string) => send('bookmarkAction', { id: item?.id, action });
    if (item) {
      if (item.type === 'bookmark') {
        for (const action of ['Open in new tab', 'Open in new window', 'Open in private window'])
          if (action !== 'Open in new window' || !isPrivate) actions.push([action, () => osAction(action)]);
        actions.push(['Copy link', () => osAction('Copy link')]);
      } else actions.push(['Open all in tabs', () => osAction('Open all in tabs')]);
      actions.push(
        ['Edit…', () => edit(item.type, target.parentFolderId ?? parentOf(item), item)],
        ['Delete', () => send('removeBookmark', {id:item.id})],
      );
    }
    if (!item || item.children)
      actions.push(['New bookmark…', () => edit('bookmark', target.targetFolderId)]);
    actions.push(['New folder…', () => edit('folder', target.targetFolderId)]);
    if (barAvailable) actions.push([
      'Show bookmarks bar…',
      () => {
        const dialog = collectionDialog(doc, 'Show bookmarks bar');
        const options = doc.createElement('select');
        options.className = 'pref-input';
        options.setAttribute('aria-label', 'Show bookmarks bar');
        for (const mode of ['Always', 'On hover', 'Never']) options.add(new Option(mode, mode));
        options.value = barMode;
        options.onchange = () => {
          send('setBookmarkBar', {mode:options.value});
          dialog.close();
        };
        const close = doc.createElement('button');
        close.className = 'pref-button';
        close.textContent = 'Done';
        close.onclick = () => dialog.close();
        const footer = doc.createElement('footer');
        footer.append(close);
        dialog.append(options, footer);
        dialog.showModal();
      },
    ]);
    for (const [label, action] of actions) {
      const b = doc.createElement('button');
      b.className = 'menu-item';
      b.textContent = label;
      b.setAttribute('role', 'menuitem');
      b.onclick = () => {
        closeMenu();
        trigger?.focus();
        action();
      };
      menu.append(b);
    }
    doc.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.inset = 'auto';
    menu.style.left =
      Math.max(4, Math.min(target.clientX ?? 0, doc.documentElement.clientWidth - rect.width - 4)) + 'px';
    menu.style.top =
      Math.max(4, Math.min(target.clientY ?? 0, doc.defaultView!.innerHeight - rect.height - 4)) + 'px';
    const buttons = [...menu.querySelectorAll('button')];
    buttons[0].focus();
    menu.onkeydown = (e) => {
      if (e.key === 'Escape') {
        closeMenu();
        trigger?.focus();
      } else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        buttons[
          (buttons.indexOf(doc.activeElement as HTMLButtonElement) +
            (e.key === 'ArrowDown' ? 1 : -1) +
            buttons.length) %
            buttons.length
        ].focus();
      }
    };
  }
  function parentOf(item: Bookmark, items = root, parent?: string): string | undefined {
    if (items.includes(item)) return parent;
    for (const child of items)
      if (child.children) {
        const found = parentOf(item, child.children, child.id);
        if (found) return found;
      }
  }
  doc.addEventListener('WebUIMessage', event => {
    const {name, data} = (event as CustomEvent).detail;
    if (name === 'loadBookmarks') root = data;
    if (name === 'bookmarkBar') {
      barMode = data.mode;
      isPrivate = data.private;
      barAvailable = data.available;
    }
  });
  doc.addEventListener('bookmarkUI', event => {
    const {action, target} = (event as CustomEvent).detail;
    if (action === 'menu') context(target);
    if (action === 'folder') edit('folder', target.targetFolderId);
  });
}
