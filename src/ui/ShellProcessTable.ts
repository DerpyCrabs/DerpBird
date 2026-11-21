import type { ShellDialog } from '../browser/protocol';
import type { ShellController } from '../browser/controller';

export function mountProcessTable(host: HTMLElement, controller: ShellController) {
  host.innerHTML = `<input type="search" class="pref-input" placeholder="Search processes" aria-label="Search processes">
    <div class="shell-process-list"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    <button type="button" class="pref-button" disabled>End process</button>`;
  const search = host.querySelector('input')!;
  const end = host.querySelector<HTMLButtonElement>('button')!;
  end.classList.add('shell-process-end');
  host.closest('form')!.querySelector('footer')!.prepend(end);
  const body = host.querySelector('tbody')!;
  const keys = ['name', 'pid', 'cpu', 'bytes'] as const;
  let sort: typeof keys[number] = 'name', reverse = false, model: ShellDialog | undefined;
  const selected = new Set<number>();
  for (const [index, key] of keys.entries()) {
    const cell = document.createElement('th'), button = document.createElement('button');
    button.type = 'button'; button.textContent = ['Process','PID','CPU','Memory'][index];
    button.onclick = () => { reverse = sort === key ? !reverse : key === 'cpu' || key === 'bytes'; sort = key; render(); };
    cell.append(button); host.querySelector('thead tr')!.append(cell);
  }
  function render() {
    body.replaceChildren();
    const rows = [...(model?.processes ?? [])].filter(r => [r.name, r.pid, ...r.pages].join(' ').toLowerCase().includes(search.value.toLowerCase()));
    rows.sort((a,b) => (sort === 'name' ? a.name.localeCompare(b.name) : a[sort] - b[sort]) * (reverse ? -1 : 1));
    for (const r of rows) {
      const tr = body.insertRow(), label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; box.disabled = !r.canEnd; box.checked = selected.has(r.id);
      box.onchange = () => { if (box.checked) selected.add(r.id); else selected.delete(r.id); end.disabled = !selected.size; };
      label.append(box, r.name); const name = tr.insertCell(); name.append(label);
      if (r.pages.length) { const detail = document.createElement('small'); detail.textContent = r.pages.join(' · '); name.append(detail); }
      for (const value of [r.pid, r.cpu.toFixed(1) + '%', (r.bytes / 1048576).toFixed(1) + ' MiB']) tr.insertCell().textContent = String(value);
    }
    end.disabled = !selected.size;
  }
  search.oninput = render;
  end.onclick = () => {
    if (model) for (const id of selected) controller.send({type:'dialog.edit', id:model.id, value:String(id)});
    selected.clear(); render();
  };
  return (d?: ShellDialog) => {
    host.hidden = d?.kind !== 'processes';
    end.hidden = host.hidden;
    if (host.hidden) { model = undefined; return; }
    if (model?.id !== d!.id) { selected.clear(); search.value = ''; }
    model = d;
    render();
  };
}
