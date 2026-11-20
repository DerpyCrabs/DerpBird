import historyDocument from '@bird/../vendor/ladybird/Base/res/ladybird/about-pages/history.html?raw';
import bookmarksDocument from '@bird/../vendor/ladybird/Base/res/ladybird/about-pages/bookmarks.html?raw';
import base from '@bird/../vendor/ladybird/Base/res/ladybird/ladybird.css?raw';
import webui from '@bird/../vendor/ladybird/Base/res/ladybird/about-pages/webui.css?raw';
import { mountCollectionUI } from '@bird/ui/collections/pages';
import { bookmark, reading } from './model';
import { bookmarkBridge } from './bookmarks';
import { mountStudy } from '../settings-study/study';

type Emit = (name: string, data: unknown) => void;
const documents = { history: historyDocument, bookmarks: bookmarksDocument };

function historyBridge(doc: Document, emit: Emit, root: HTMLElement) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  let entries = reading.map((_, i) => {
    const item = bookmark(i),
      day = new Date(start);
    day.setDate(day.getDate() - (i < 4 ? 0 : i < 7 ? 1 : 2));
    day.setHours(10, 45 - 7 * i);
    return {
      title: item.title,
      url: item.url!,
      siteKey: new URL(item.url!).hostname,
      faviconBase64Png: item.favicon,
      lastVisitedTime: +day,
    };
  });
  // Delegate to the same privacy dialog used by the unified settings demo.
  doc.getElementById('clear-history')!.addEventListener(
    'click',
    async (e) => {
      e.stopImmediatePropagation();
      const layer = document.createElement('div');
      layer.style.cssText = 'position:absolute;inset:0';
      root.append(layer);
      layer.addEventListener(
        'cleared-demo-data',
        (event) => {
          const { history, since } = (event as CustomEvent<{ history: boolean; since?: number }>).detail;
          if (history) {
            entries = entries.filter((entry) => entry.lastVisitedTime < (since ?? -Infinity));
            doc.querySelector('#history-search')!.dispatchEvent(new Event('input'));
          }
        },
        true,
      );
      const dispose = await mountStudy(layer, 'clearBrowsingData');
      const settings = layer.querySelector('iframe')!.contentDocument!;
      const dialog = settings.querySelector<HTMLDialogElement>('#browsing-data-settings-dialog')!;
      dialog.addEventListener(
        'close',
        () => {
          dispose();
          layer.remove();
          doc.getElementById('clear-history')?.focus();
        },
        { once: true },
      );
    },
    true,
  );
  return (
    name: string,
    data: { url: string; offset: number; limit: number; query: string; requestId: number },
  ) => {
    if (name === 'loadHistoryEntries') {
      const results = entries.filter((e) =>
        (e.title + ' ' + e.url).toLowerCase().includes(data.query.toLowerCase()),
      );
      emit(name, {
        ...data,
        entries: results.slice(data.offset, data.offset + data.limit),
        hasMore: results.length > data.offset + data.limit,
      });
    } else if (name === 'removeHistoryEntry') entries = entries.filter((e) => e.url !== data.url);
    else if (name === 'forgetHistorySite')
      entries = entries.filter((e) => e.siteKey !== new URL(data.url).hostname);
    else throw Error('Unknown history action: ' + name);
  };
}
export async function mountCollection(root: HTMLElement, page: string) {
  if (!Object.hasOwn(documents, page)) throw Error('Unknown collection');
  const frame = document.createElement('iframe');
  frame.title = page[0].toUpperCase() + page.slice(1);
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  let html = documents[page as keyof typeof documents]
    .replace('<head>', '<head><meta charset="utf-8">')
    .replace(/<link[^>]*href="resource:[^>]+>/g, '')
    .replace('<style>', '<style>' + base + '\n' + webui + '</style><style>')
    .replace(/<script[^>]*src="resource:[^"]*collections.js"[^>]*><\/script>/g, '');
  frame.srcdoc = html;
  root.append(frame);
  await loaded;
  const doc = frame.contentDocument!;
  const emit: Emit = (name, data) =>
    doc.dispatchEvent(new CustomEvent('WebUIMessage', { detail: { name, data: structuredClone(data) } }));
  const sendMessage = page === 'history' ? historyBridge(doc, emit, root) : bookmarkBridge(doc, emit);
  Object.defineProperty(frame.contentWindow!, 'ladybird', { value: { sendMessage }, configurable: true });
  mountCollectionUI(doc, page);
  doc.dispatchEvent(new Event('WebUILoaded'));
  return () => frame.remove();
}
