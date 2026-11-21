import { mountColorPicker } from './ShellColorPicker';
import type { ShellDialog } from '../browser/protocol';

const pad = (n: number) => String(n).padStart(2, '0');
function dayValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function weekValue(date: Date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${pad(week)}`;
}
export function mountValuePicker(host: HTMLElement, input: HTMLInputElement, preview: (value: string) => void) {
  let sync = () => {};
  input.addEventListener('input', () => sync());
  return (d: ShellDialog) => {
    host.replaceChildren(); sync = () => {};
    if (d.kind === 'color') {
      sync = mountColorPicker(host,input,preview);
      sync(); return;
    }
    if (!['date','datetime-local','month','week'].includes(d.kind)) return;
    const initial = /^(\d{4})-(\d{2})/.exec(d.value);
    const month = initial ? new Date(+initial[1], +initial[2] - 1, 1) : new Date();
    month.setDate(1);
    function draw() {
      host.replaceChildren();
      const header = document.createElement('div'); header.className = 'shell-calendar-header';
      function arrow(text: string, delta: number) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pref-button';
        b.textContent = text; b.ariaLabel = delta < 0 ? 'Previous month' : 'Next month';
        b.onclick = () => { month.setMonth(month.getMonth() + delta); draw(); };
        return b;
      }
      const caption = document.createElement('strong');
      caption.textContent = month.toLocaleDateString(undefined, { month: 'long', year:'numeric' });
      header.append(arrow('‹', -1), caption, arrow('›', 1)); host.append(header);
      const days = document.createElement('div'); days.className = 'shell-calendar-grid';
      const start = (month.getDay() + 6) % 7;
      for (let i = 0; i < 7; ++i) {
        const day = document.createElement('span');
        day.textContent = new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday:'short' });
        days.append(day);
      }
      const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      for (let n = 1; n <= count; ++n) {
        const b = document.createElement('button'), date = new Date(month.getFullYear(), month.getMonth(), n);
        const iso = dayValue(date);
        const value = d.kind === 'week' ? weekValue(date) : d.kind === 'month' ? iso.slice(0,7) :
          d.kind === 'datetime-local' ? iso + 'T' + (input.value.split('T')[1] || '00:00') : iso;
        b.type = 'button'; b.className = 'pref-button'; b.textContent = String(n); b.ariaLabel = iso;
        if (n === 1) b.style.gridColumnStart = String(start + 1);
        b.disabled = !!((d.minimum && value < d.minimum) || (d.maximum && value > d.maximum));
        b.setAttribute('aria-pressed', String(value === input.value));
        b.onclick = () => { input.value = value; draw(); };
        days.append(b);
      }
      host.append(days);
    }
    draw();
  };
}
