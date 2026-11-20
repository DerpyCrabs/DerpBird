import { inform } from './model';
import type { BrowserDownload } from '@bird/browser/protocol';
import { createDownloadMenu, downloadEntry } from '@bird/ui/collections/download-menu';

export function mountDownloads(initiallyOpen: boolean, empty: boolean) {
  const files: Omit<BrowserDownload, 'id' | 'path' | 'resumable'>[] = [
    { name: 'Type specimens.zip', received: 12_000_000, total: 30_000_000, status: 'Downloading' },
    { name: 'Field recordings.wav', received: 19_900_000, total: 75_500_000, status: 'Paused' },
    { name: 'Navigation study.pdf', received: 2_400_000, status: 'Finished' },
    { name: 'Interface tokens.json', received: 12_000, status: 'Finished' },
    { name: 'Archive.tar.gz', received: 8_000_000, total: 64_000_000, status: 'Failed' },
  ];
  const entries = (empty ? [] : files).map((file, index) => ({ ...file, id: String(index), path: '~/Downloads/' + file.name, resumable: true }));
  const menu = createDownloadMenu(entries.map(downloadEntry), (action, id) => {
    const file = entries.find(entry => entry.id === id);
    if (action === 'clear') {
      for (let i = entries.length - 1; i >= 0; i--) if (!['Paused', 'Downloading'].includes(entries[i].status)) entries.splice(i, 1);
    } else if (file && action === 'cancel') file.status = 'Canceled';
    else if (file && action === 'pause') file.status = 'Paused';
    else if (file && action === 'resume') file.status = 'Downloading';
    else if (file && (action === 'open' || action === 'reveal'))
      inform(document, action === 'open' ? 'Open file' : 'Show in folder', file.path);
    menu.update(entries.map(downloadEntry));
  });
  if (initiallyOpen) menu.open();
  return menu;
}
