import { iconNode as archive } from '@effectweb/lucide/icons/file-archive';
import { iconNode as audio } from '@effectweb/lucide/icons/file-audio';
import { iconNode as json } from '@effectweb/lucide/icons/file-json';
import { iconNode as documentFile } from '@effectweb/lucide/icons/file-text';
import './download-menu.css';
import type { BrowserDownload } from '../../browser/protocol';

export type DownloadEntry = Pick<BrowserDownload, 'thumbnail' | 'id' | 'name' | 'path' | 'status' | 'resumable' | 'startedAt' | 'finishedAt'> & { size: string };
export type DownloadAction = 'clear' | 'cancel' | 'pause' | 'resume' | 'open' | 'reveal' | 'thumbnail' | 'drag';
export function downloadSize(file: Pick<BrowserDownload, "received" | "total" | "status">): string {
  function size(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log10(Math.max(bytes, 1)) / 3)));
    return { value: Number((bytes / 1000 ** power).toFixed(1)), unit: units[power] };
  }
  const received = size(file.received);
  let description = received.value + ' ' + received.unit;
  if (file.total !== undefined && file.status !== 'Finished') {
    const total = size(file.total);
    description = (received.unit === total.unit ? received.value : description) + ' of ' + total.value + ' ' + total.unit;
  }
  return description;
}
export function downloadEntry(file: BrowserDownload): DownloadEntry {
  return { ...file, size: downloadSize(file) };
}
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' });

function downloadAge(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return relativeTime.format(0, 'second');
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return relativeTime.format(-days, 'day');
  return shortDate.format(timestamp);
}

function updateMetadata(row: HTMLElement, file: DownloadEntry, now: number) {
  const meta = row.querySelector('small')!;
  const timestamp = file.finishedAt ?? file.startedAt;
  let text = file.status + ' · ' + file.size;
  if (timestamp !== undefined) {
    text += ' · ' + downloadAge(timestamp, now);
    const title = (file.finishedAt !== undefined ? 'Finished' : 'Started') + ' · ' + fullDate.format(timestamp);
    if (row.title !== title) row.title = title;
  } else {
    row.removeAttribute('title');
  }
  if (meta.textContent !== text) meta.textContent = text;
}

const paths = {
  download: 'M8 2v8m-3-3 3 3 3-3M2 10v3h12v-3',
  pause: 'M5 3v10m6-10v10',
  resume: 'm5 3 8 5-8 5z',
  more: 'M3 8h.1M8 8h.1M13 8h.1',
  open: 'M6 3h7v7m0-7L4 12',
};
function button(label: string, action: () => void, icon?: keyof typeof paths) {
  const b = document.createElement('button');
  b.type = 'button';
  if (icon) {
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + paths[icon] + '"/></svg>';
  } else b.textContent = label;
  b.onclick = action;
  return b;
}
function fileIcon(name: string) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const shapes = /\.(zip|gz|bz2|xz|tar|rar|7z)$/i.test(name) ? archive : /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(name) ? audio : /\.json$/i.test(name) ? json : documentFile;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('file-format');
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}

export function createDownloadMenu(files: readonly DownloadEntry[], act: (action: DownloadAction, id?: string) => void) {
  const panel = document.createElement('section');
  panel.id = 'downloads-popover';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Downloads');
  const trigger = button('Downloads', () => panel.hidden ? open() : close(), 'download');
  trigger.id = 'downloads-indicator';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-expanded', 'false');
  document.querySelector('.proxy-switcher-button')!.before(trigger);
  document.body.append(panel);
  let clock: number | undefined;
  let submenu: HTMLElement | undefined;
  let invoker: HTMLButtonElement | undefined;
  function dismissSubmenu(restoreFocus = true) {
    submenu?.remove();
    submenu = undefined;
    invoker?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) invoker?.focus();
    invoker = undefined;
  }
  function placeSubmenu() {
    if (!submenu || !invoker) return;
    const row = invoker.getBoundingClientRect();
    const list = panel.getBoundingClientRect();
    const gap = 4;
    const w = submenu.offsetWidth;
    const h = submenu.offsetHeight;
    const beside = list.left >= w + 2 * gap || innerWidth - list.right >= w + 2 * gap;
    const x = beside ? (innerWidth - list.right >= w + 2 * gap ? list.right + gap : list.left - w - gap) : row.right - w;
    const y = beside ? row.top : row.bottom + h + gap < innerHeight ? row.bottom + gap : row.top - h - gap;
    submenu.style.left = Math.max(gap, Math.min(innerWidth - w - gap, x)) + 'px';
    submenu.style.top = Math.max(gap, Math.min(innerHeight - h - gap, y)) + 'px';
  }
  function showActions(file: DownloadEntry, anchor: HTMLButtonElement) {
    const alreadyOpen = anchor === invoker;
    dismissSubmenu(false);
    if (alreadyOpen) return;
    invoker = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    submenu = document.createElement('div');
    submenu.id = 'download-actions';
    submenu.setAttribute('role', 'menu');
    submenu.setAttribute('aria-label', file.name);
    const command = (label: string, run: () => void) => {
      const item = button(label, () => { dismissSubmenu(); run(); });
      item.setAttribute('role', 'menuitem');
      submenu!.append(item);
    };
    if (active(file)) command('Cancel download', () => act('cancel', file.id));
    if (file.status === 'Finished') {
      command('Open file', () => act('open', file.id));
      command('Show in folder', () => act('reveal', file.id));
    }
    command('Copy file path', () => {
      const input = document.createElement('textarea');
      input.value = file.path;
      panel.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      anchor.focus();
    });
    panel.append(submenu);
    placeSubmenu();
    submenu.querySelector('button')!.focus();
  }
  const active = (file: DownloadEntry) => ['Downloading','Paused'].includes(file.status);
  function position() {
    const r = trigger.getBoundingClientRect();
    panel.style.left = Math.max(6, Math.min(innerWidth - panel.offsetWidth - 6, r.right - panel.offsetWidth)) + 'px';
    panel.style.top = (r.bottom + panel.offsetHeight + 4 <= innerHeight ? r.bottom + 4 : Math.max(4, r.top - panel.offsetHeight - 4)) + 'px';
  }
  function showThumbnail(handle: Element, url: string) {
    if (handle.firstElementChild instanceof HTMLImageElement) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.draggable = false;
    handle.replaceChildren(image);
  }
  function render() {
    const focus = document.activeElement as HTMLElement;
    const index = [...panel.querySelectorAll('button')].indexOf(focus as HTMLButtonElement);
    trigger.toggleAttribute('data-active', files.some(f => f.status === 'Downloading'));
    panel.replaceChildren();
    panel.toggleAttribute('data-empty', files.length === 0);
    if (!files.length) {
      const message = document.createElement('span');
      message.textContent = 'No downloads';
      panel.append(message);
      if (!panel.hidden) {
        position();
        if (index >= 0) panel.focus({ preventScroll: true });
      }
      return;
    }
    const header = document.createElement('header');
    const heading = document.createElement('strong');
    heading.textContent = 'Downloads';
    header.append(heading);
    panel.append(header);
    if (files.some(f => !active(f))) header.append(button('Clear finished', () => act('clear')));
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'transfer-row';
      row.dataset.id = file.id;
      const label = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = file.name;
      const meta = document.createElement('small');
      label.append(name, meta);
      const handle = document.createElement('span');
      handle.className = 'download-icon';
      handle.append(fileIcon(file.name));
      if (file.thumbnail) showThumbnail(handle, file.thumbnail);
      else if (!panel.hidden && file.status === 'Finished' && /\.(png|jpe?g|gif|webp|avif|bmp|mp4|m4v|mov|mkv|webm|avi)$/i.test(file.name))
        act('thumbnail', file.id);
      if (file.status === 'Finished') {
        handle.classList.add('draggable');
        handle.onpointerdown = down => {
          if (down.button !== 0) return;
          down.preventDefault();
          handle.setPointerCapture(down.pointerId);
          handle.onpointermove = move => {
            if (!(move.buttons & 1) || Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < 6) return;
            handle.releasePointerCapture(down.pointerId);
            handle.onpointermove = null;
            act('drag', file.id);
          };
          handle.onlostpointercapture = () => { handle.onpointermove = null; };
        };
      }
      row.append(handle, label);
      if (file.resumable && (active(file) || file.status === 'Failed')) {
        const pause = file.status === 'Downloading';
        const verb = pause ? 'Pause' : file.status === 'Paused' ? 'Resume' : 'Retry';
        row.append(button(verb + ' ' + file.name, () => act(pause ? 'pause' : 'resume', file.id), pause ? 'pause' : 'resume'));
      }
      const more = button('Actions for ' + file.name, () => showActions(file, more), 'more');
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      more.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); showActions(file, more); }
      };
      row.append(more);
      updateMetadata(row, file, Date.now());
      panel.append(row);
    }
    if (!panel.hidden) position();
    if (index >= 0) {
      const buttons = panel.querySelectorAll('button');
      buttons[Math.min(index, buttons.length - 1)]?.focus();
    }
  }
  function open() {
    dismissSubmenu(false);
    panel.setAttribute('role', 'dialog');
    panel.hidden = false;
    if (clock === undefined) clock = window.setInterval(() => {
      const now = Date.now();
      panel.querySelectorAll<HTMLElement>('.transfer-row').forEach((row, i) => updateMetadata(row, files[i], now));
    }, 30_000);
    trigger.setAttribute('aria-expanded', 'true');
    render();
    panel.tabIndex = -1;
    panel.focus({preventScroll:true});
  }
  function close() {
    dismissSubmenu();
    panel.hidden = true;
    window.clearInterval(clock);
    clock = undefined;
    panel.removeAttribute('role');
    trigger.setAttribute('aria-expanded', 'false');
    if (panel.contains(document.activeElement)) trigger.focus();
  }
  function outside(e: Event) {
    if (submenu && !submenu.contains(e.target as Node) && !invoker?.contains(e.target as Node)) dismissSubmenu(false);
    if (!panel.hidden && !panel.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  }
  function key(e: KeyboardEvent) {
    if (submenu && (e.key === 'Escape' || e.key === 'ArrowLeft')) {
      e.preventDefault(); dismissSubmenu(); return;
    }
    if (submenu && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault();
      const items = [...submenu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      return;
    }
    if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(); }

  }
  const listeners = new AbortController();
  const options = {signal:listeners.signal};
  document.addEventListener('pointerdown', outside, options);
  document.addEventListener('keydown', key, options);
  window.addEventListener('resize', () => { position(); placeSubmenu(); }, options);
  panel.addEventListener('scroll', placeSubmenu, options);
  render();
  let structure = '';
  function update(next: readonly DownloadEntry[]) {
    files = next;
    // Preserve the open submenu and keyboard focus during progress ticks.
    const key = JSON.stringify(next.map(f => [f.id, f.name, f.status, f.resumable, f.path]));
    if (key === structure) {
      const rows = panel.querySelectorAll<HTMLElement>('.transfer-row');
      next.forEach((f, i) => {
        const row = rows[i];
        if (!row) return;
        updateMetadata(row, f, Date.now());
        if (f.thumbnail) showThumbnail(row.querySelector('.download-icon')!, f.thumbnail);
      });
      return;
    }
    structure = key;
    dismissSubmenu(false);
    render();
  }
  return { open, close, update, dispose() { window.clearInterval(clock); listeners.abort(); trigger.remove(); panel.remove(); } };
}
