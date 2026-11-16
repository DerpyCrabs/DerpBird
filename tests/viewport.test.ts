import { expect, test } from 'bun:test';
import { surfaceRect, observeViewport } from '../src/browser/viewport';
import { Window } from 'happy-dom';
import type { Command } from '../src/browser/protocol';

test('content rectangle excludes borders and rounds inwards', () => {
  expect(surfaceRect({ left: 226.25, top: 58.5, right: 1192.2, bottom: 792.8 }, 1))
    .toEqual({ x: 228, y: 60, width: 963, height: 731 });
});
test('clamps offscreen or empty rectangles', () => {
  expect(surfaceRect({ left: -10, top: -20, right: 80, bottom: 40 })).toEqual({ x: 0, y: 0, width: 80, height: 40 });
  expect(surfaceRect({ left: 0, top: 0, right: 0, bottom: 0 }, 1)).toEqual({ x: 1, y: 1, width: 0, height: 0 });
});
test('coalesces geometry notifications, deduplicates updates, and tears down', async () => {
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"><section id="content-surface"></section></div>';
  let width = 1200;
  const content = window.document.getElementById('content-surface')!;
  content.getBoundingClientRect = () => new window.DOMRect(226, 58, width - 234, 734);
  const commands: Command[] = [];
  const close = observeViewport(window.document as unknown as Document, command => commands.push(command), () => true);
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    await settle(); expect(commands).toHaveLength(1);
    for (let i = 0; i < 20; i++) window.dispatchEvent(new window.Event('resize'));
    await settle(); expect(commands).toHaveLength(1);
    width = 1000;
    for (let i = 0; i < 20; i++) window.dispatchEvent(new window.Event('resize'));
    await settle(); expect(commands).toHaveLength(2);
    const menu = window.document.createElement('section'); menu.className = 'browser-menu';
    menu.getBoundingClientRect = () => new window.DOMRect(650, 53, 335, 250);
    window.document.getElementById('app')!.append(menu);
    await settle(); expect(commands.at(-1)).toMatchObject({ type: 'shell.viewport', overlays: [{ x: 650, y: 53, width: 335, height: 250 }] });
    close(); const count = commands.length; width = 900;
    window.dispatchEvent(new window.Event('resize')); await settle(); expect(commands).toHaveLength(count);
  } finally { close(); await window.happyDOM.close(); }
});

 test('native page covers fractional boundaries below the transparent shell', () => {
  expect(surfaceRect({left: 0, top: 104.375, right: 799.75, bottom: 412.5}, 0, 'cover')).toEqual({x: 0, y: 104, width: 800, height: 309});
});


test('drag capture preserves the viewport instead of excluding its pixels', async () => {
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"><section id="content-surface"><div class="split-drag-surface" hidden></div></section></div>';
  const commands: Command[] = [];
  const close = observeViewport(window.document as unknown as Document, command => commands.push(command), () => true);
  const overlay = window.document.querySelector('.split-drag-surface') as unknown as HTMLElement;
  try {
    overlay.hidden = false;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(commands.at(-1)).toMatchObject({ type: 'shell.viewport', captureInput: true, overlays: [] });
    overlay.hidden = true;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(commands.at(-1)).not.toHaveProperty('captureInput');
  } finally { close(); await window.happyDOM.close(); }
});

for (const className of ['address-palette', 'style-manager']) test(`${className} captures modal input without hiding the page`, async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<div id="app"><section id="content-surface"></section></div>';
  document.documentElement.getBoundingClientRect = () => new window.DOMRect(0, 0, 1000, 760);
  document.getElementById('content-surface')!.getBoundingClientRect = () => new window.DOMRect(240, 0, 760, 760);
  const commands: Command[] = [];
  const stop = observeViewport(document as unknown as Document, command => commands.push(command), () => true);
  try {
    const dialog = document.createElement('dialog');dialog.className = className;
    dialog.getBoundingClientRect = () => new window.DOMRect(300, 200, 600, 300);
    dialog.setAttribute('open', '');document.getElementById('app')!.append(dialog);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(commands.at(-1)).toEqual({type:'shell.viewport',rect:{x:240,y:0,width:760,height:760},overlays:[],captureInput:true});
    dialog.remove();await new Promise(resolve => setTimeout(resolve, 30));
    expect(commands.at(-1)).toEqual({type:'shell.viewport',rect:{x:240,y:0,width:760,height:760},overlays:[]});
  } finally {stop();await window.happyDOM.close();}
});
