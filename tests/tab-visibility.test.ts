import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { observeActiveTab } from '../src/browser/tab-visibility';

test('reveals selected tabs on either axis without stealing focus or undoing manual scrolling on title updates', async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main class="shell horizontal"><input><div class="tab-list"><div class="tab"><button role="tab" aria-selected="false">First</button></div><div class="tab"><button role="tab" aria-selected="true">Last</button></div></div></main>';
  const list = document.querySelector('.tab-list')! as unknown as HTMLElement;
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const buttons = Array.from(document.querySelectorAll('button'));
  let vertical = false;
  list.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 100) as unknown as DOMRect;
  tabs.forEach((tab, i) => {
    tab.getBoundingClientRect = () => new window.DOMRect(vertical ? 0 : i * 200 - list.scrollLeft,
      vertical ? i * 200 - list.scrollTop : 0, 40, 36);
  });
  const input = document.querySelector('input')!; input.focus();
  const stop = observeActiveTab(document as unknown as Document);
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    await settle(); expect(list.scrollLeft).toBe(140); expect(document.activeElement).toBe(input);
    buttons[1]!.setAttribute('aria-selected', 'false'); buttons[0]!.setAttribute('aria-selected', 'true');
    await settle(); expect(list.scrollLeft).toBe(0);
    list.scrollLeft = 10; buttons[0]!.textContent = 'Updated title';
    await settle(); expect(list.scrollLeft).toBe(10);
    vertical = true; document.querySelector('.shell')!.className = 'shell vertical';
    buttons[0]!.setAttribute('aria-selected', 'false'); buttons[1]!.setAttribute('aria-selected', 'true');
    await settle(); expect(list.scrollTop).toBe(136); expect(document.activeElement).toBe(input);
    stop(); buttons[1]!.setAttribute('aria-selected', 'false'); buttons[0]!.setAttribute('aria-selected', 'true');
    await settle(); expect(list.scrollTop).toBe(136);
  } finally { stop(); await window.happyDOM.close(); }
});
