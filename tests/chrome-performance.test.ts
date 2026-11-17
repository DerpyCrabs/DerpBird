import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { observeTabMotion } from '../src/ui/design/tab-motion';
import { observeContour } from '../src/ui/design/contour';
import { observePinLayout } from '../src/ui/design/pin-layout';

function fixture() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main class="shell horizontal"><aside class="tabs"><div class="tab-list"><div class="tab-unit"><div class="tab active"><button role="tab" data-tab-id="a"><span class="tab-icon"></span><span class="tab-title">A</span></button></div></div><div class="tab-unit"><div class="tab"><button role="tab" data-tab-id="b"><span class="tab-icon"></span><span class="tab-title">B</span></button></div></div></div></aside></main>';
  const frames = new Map<number, FrameRequestCallback>();
  const mutations: MutationCallback[] = [];
  let id=0;
  const globals: Record<string, unknown> = {
    document,
    MutationObserver: class { constructor(callback: MutationCallback) { mutations.push(callback); } observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    matchMedia: () => ({ matches: false }), DOMRect: window.DOMRect,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const list=document.querySelector('.tab-list')! as unknown as HTMLElement;
  const host=document.querySelector('.tabs')! as unknown as HTMLElement;
  const shell=document.querySelector('.shell')! as unknown as HTMLElement;
  const log: string[]=[];
  const units=Array.from(list.querySelectorAll<HTMLElement>('.tab-unit'));
  for(const [i,unit] of units.entries()) {
    for(const node of [unit,unit.querySelector<HTMLElement>('.tab')!,unit.querySelector<HTMLElement>('.tab-icon')!])
      node.getBoundingClientRect=()=>{log.push('read');return new window.DOMRect(i*150-list.scrollLeft,0,unit.closest('.pinned-tabs')?28:(list.querySelector('.pinned-tabs')?180:150),30) as unknown as DOMRect;};
    const style=unit.querySelector<HTMLElement>('.tab')!.style;
    Object.defineProperty(unit.querySelector('.tab')!,'style',{configurable:true,value:new Proxy(style,{set(target,key,value){if(key==='width')log.push('write-width');Reflect.set(target,key,value);return true;}})});
  }
  list.getBoundingClientRect=host.getBoundingClientRect=()=>new window.DOMRect(0,0,300,40) as unknown as DOMRect;
  Object.defineProperties(host,{clientWidth:{value:300},clientHeight:{value:40}});
  return {window,document,list,host,shell,log,units,frames,
    mutate:(target: Node)=>mutations.forEach(callback=>callback([{type:'childList',target,addedNodes:[],removedNodes:[]} as unknown as MutationRecord],{} as MutationObserver)),
    frame:(time=0)=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback(time));},
    close:async()=>{for(const [key,value] of previous) {if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}await window.happyDOM.close();},
  };
}

test('tab motion skips scroll/title measurements and batches animated layout reads',async()=>{
  const f=fixture();const stop=observeTabMotion(f.list);
  try {
    f.log.length=0;
    f.list.scrollLeft=50;f.list.dispatchEvent(new f.window.Event('scroll') as unknown as Event);
    f.mutate(f.list.querySelector('.tab-title')!);f.frame();
    expect(f.log).toEqual([]);
    const pinned=f.document.createElement('div');pinned.className='pinned-tabs';f.list.prepend(pinned as unknown as Node);pinned.append(f.units[0]! as any);
    f.mutate(f.list);f.frame(0);f.log.length=0;f.frame(140);
    const firstRead=f.log.indexOf('read');
    expect(firstRead).toBeGreaterThan(0);
    expect(f.log.slice(firstRead).includes('write-width')).toBe(false);
    f.frame(performance.now()+300);expect(f.list.dataset.tabLayoutAnimating).toBe('false');
    f.list.append(f.units[0]!);pinned.remove();f.mutate(f.list);f.frame(performance.now());
    f.log.length=0;stop();expect(f.log).toEqual([]);
    expect(f.units[0]!.querySelector<HTMLElement>('.tab')!.style.width).toBe('');
    expect(f.frames.size).toBe(0);
  } finally {stop();await f.close();}
});

test('contour retains clip and line nodes, skips identical paths, replaces changed paths',async()=>{
  const f=fixture();let active=f.units[0]!.querySelector<HTMLElement>('.tab')!;
  const stop=observeContour(f.host,f.list,()=>active,()=>39,.5);
  try {
    f.frame();const svg=f.host.querySelector('svg')!;
    const clip=svg.querySelector('clipPath rect'),lines=[...svg.querySelectorAll('line')],path=svg.querySelector('path');
    f.list.dispatchEvent(new f.window.Event('scroll') as unknown as Event);f.frame();expect(svg.querySelector('path')).toBe(path);
    active=f.units[1]!.querySelector<HTMLElement>('.tab')!;f.mutate(f.list);f.frame(10);f.frame(300);
    expect(svg.querySelector('path')).not.toBe(path);
    expect(svg.querySelector('clipPath rect')).toBe(clip);
    expect([...svg.querySelectorAll('line')]).toEqual(lines);
  } finally {stop();await f.close();}
});

test('pin layout ignores content changes elsewhere in the shell',async()=>{
  const f=fixture();const pinned=f.document.createElement('div');pinned.className='pinned-tabs';f.list.prepend(pinned as unknown as Node);
  let reads=0;Object.defineProperty(pinned,'clientWidth',{get:()=>{reads++;return 180;}});
  const stop=observePinLayout(f.shell);
  try {
    reads=0;f.mutate(f.list.querySelector('.tab-title')!);expect(reads).toBe(0);
    f.mutate(pinned as unknown as Node);expect(reads).toBe(1);
  } finally {stop();await f.close();}
});
