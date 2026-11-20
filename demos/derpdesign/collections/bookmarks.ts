import { bookmark, inform, type Bookmark } from './model';

type Target = { id?: string; targetFolderId?: string; index?: number; clientX?: number; clientY?: number };
export function bookmarkBridge(doc: Document, emit: (name: string, data: unknown) => void) {
  const root: Bookmark[] = [
    { id: 'research', type: 'folder', title: 'Research', children: [bookmark(3), bookmark(5)] },
    { id: 'work', type: 'folder', title: 'Projects', children: [bookmark(4)] },
    bookmark(0),
    bookmark(1),
    bookmark(2),
    bookmark(7),
  ];
  const refresh = () => emit('loadBookmarks', root);
  function find(id?: string, items = root): Bookmark | undefined {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const result = find(id, item.children);
        if (result) return result;
      }
    }
  }
  function detach(id: string, items = root): boolean {
    const i = items.findIndex((item) => item.id === id);
    if (i >= 0) {
      items.splice(i, 1);
      return true;
    }
    return items.some((item) => item.children && detach(id, item.children));
  }
  function move(item: Bookmark, folderId?: string, index?: number) {
    const dest = folderId ? find(folderId)?.children : root;
    if (!dest || item.id === folderId || (item.children && folderId && find(folderId, item.children))) return;
    const before = dest.indexOf(item);
    detach(item.id);
    const to = index === undefined ? dest.length : index - (before >= 0 && before < index ? 1 : 0);
    dest.splice(Math.max(0, to), 0, item);
  }
  let barMode = 'Never';
  return (name: string, data?: unknown) => {
    const target = (data ?? {}) as Target;
    switch (name) {
      case 'loadBookmarks':
        emit('bookmarkBar', { mode:barMode, private:false, available:true });
        return refresh();
      case 'setBookmarkBar':
        barMode = (data as {mode:string}).mode;
        return emit('bookmarkBar', { mode:barMode, private:false, available:true });
      case 'removeBookmark':
        if (target.id) detach(target.id);
        return refresh();
      case 'saveBookmark': {
        const draft = data as Bookmark & {targetFolderId?: string; move: boolean};
        const existing = find(draft.id);
        const item = existing ?? {id:crypto.randomUUID(), type:draft.type, title:'', ...(draft.type === 'folder' ? {children:[]} : {})};
        item.title = draft.title;
        if (item.type === 'bookmark') item.url = draft.url;
        if (!existing || draft.move) move(item, draft.targetFolderId);
        return refresh();
      }
      case 'bookmarkAction': {
        const {id, action} = data as {id:string; action:string};
        const item = find(id);
        if (action === 'Copy link' && item?.url) {
          void navigator.clipboard.writeText(item.url).catch(() => inform(doc, action, item.url!));
        } else inform(doc, action, item?.url ?? item?.children?.map(child => child.title).join(' · ') ?? '');
        return;
      }
      case 'moveItem': {
        const item = find(target.id);
        if (item) move(item, target.targetFolderId, target.index);
        return refresh();
      }
      case 'importBookmarks':
        root.push(...(data as Bookmark[]));
        return refresh();
      case 'exportBookmarks': {
        const link = doc.createElement('a');
        const url = URL.createObjectURL(new Blob([String(data)], { type: 'text/html' }));
        link.href = url;
        link.download = 'bookmarks.html';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      default:
        throw Error('Unknown bookmark action: ' + name);
    }
  };
}
