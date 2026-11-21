import type { ShellDialog } from '../browser/protocol';

export function mountBookmarkFields(host: HTMLElement) {
  host.innerHTML = `<label>Name<input class="pref-input" name="name"></label>
    <label>URL<input class="pref-input" name="url"></label>
    <label>Folder<select class="pref-input" name="folder"></select></label>`;
  const name = host.querySelector<HTMLInputElement>('[name=name]')!;
  const url = host.querySelector<HTMLInputElement>('[name=url]')!;
  const folder = host.querySelector<HTMLSelectElement>('select')!;
  let originalFolder = '';
  function update(d: ShellDialog) {
    host.hidden = !['bookmark', 'bookmark-folder'].includes(d.kind);
    url.disabled = host.hidden;
    if (host.hidden) return;
    name.value = d.value;
    url.value = d.url ?? '';
    url.parentElement!.hidden = d.kind === 'bookmark-folder';
    url.required = !url.parentElement!.hidden;
    originalFolder = d.folder ?? '';
    folder.replaceChildren(new Option('Bookmarks bar', ''), ...(d.folders ?? []).map(f => new Option(f.name, f.id)));
    folder.value = originalFolder;
  }
  return {
    update, focus: () => { name.focus(); name.setSelectionRange(name.value.length, name.value.length); },
    value: () => JSON.stringify({ name: name.value, url: url.value, folder: folder.value, moved: originalFolder !== folder.value }),
    active: () => !host.hidden,
  };
}
