export type Bookmark = {
  id: string;
  type: 'folder' | 'bookmark';
  title: string;
  children?: Bookmark[];
  url?: string;
  favicon?: string;
};
export function collectionDialog(doc: Document, title: string) {
  const dialog = doc.createElement('dialog');
  dialog.className = 'pref-dialog';
  const heading = doc.createElement('h2');
  heading.id = 'collection-dialog-title';
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.append(heading);
  doc.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}
export function inform(doc: Document, title: string, message: string) {
  const dialog = collectionDialog(doc, title);
  const text = doc.createElement('p');
  text.textContent = message;
  const footer = doc.createElement('footer');
  const done = doc.createElement('button');
  done.className = 'pref-button';
  done.textContent = 'Close';
  done.onclick = () => dialog.close();
  footer.append(done);
  dialog.append(text, footer);
  dialog.showModal();
}
