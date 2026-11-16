import {expect,test} from 'bun:test';
import {Window} from 'happy-dom';
import {observeSplitInteractions} from '../src/browser/splits';
import {canDropTab} from '../src/browser/tab-tree';
import {createBirdFixture} from '../demos/derpdesign/fixture';
import type {Command} from '../src/browser/protocol';
import type {ShellController} from '../src/browser/controller';
import type {ChromeLayout} from '../src/browser/chrome-layout';
const layouts:ChromeLayout[]=[{preset:'classic',side:'left',address:'top'},{preset:'bottom',side:'left',address:'bottom'},...(['left','right'] as const).flatMap(side=>[{preset:'compact',side,address:'top'} as ChromeLayout,...(['top','bottom'] as const).map(address=>({preset:'sidebar',side,address} as ChromeLayout))])];
for(const arrangement of layouts)test(`${arrangement.preset}/${arrangement.side}/${arrangement.address}: group, reorder, ungroup, cancel and reject invalid drops`,async()=>{
 const window=new Window(),document=window.document,f=createBirdFixture('vertical',canDropTab);
 await f.port.request({type:'shell.set-chrome-layout',layout:arrangement});
 const commands:Command[]=[];
 document.body.innerHTML='<aside class="tabs"></aside><section id="content-surface"><div class="split-drag-surface" hidden></div></section>';
 document.getElementById('content-surface')!.getBoundingClientRect=()=>new window.DOMRect(250,50,600,600);
 const render=()=>{document.querySelector('.tabs')!.innerHTML=f.snapshot().tabs.map(t=>`<div class="tab-unit"><div class="tab"><button role="tab" data-tab-id="${t.id}">${t.title}</button></div></div>`).join('');document.querySelectorAll('.tab').forEach((row,i)=>{row.getBoundingClientRect=()=>f.snapshot().preferences.layout==='vertical'?new window.DOMRect(arrangement.side==='right'?850:0,i*30,150,30):new window.DOMRect(i*150,0,150,30);});};render();
 let hit:Element|null=null;document.elementFromPoint=()=>hit as any;
 const stop=observeSplitInteractions(document as unknown as Document,{state:()=>({browser:f.snapshot(),layout:f.snapshot().preferences.layout,chromeLayout:f.snapshot().preferences.chromeLayout} as ReturnType<ShellController['state']>),send:c=>{commands.push(c);void f.port.request(c);}});
 const pointer=(type:string,x:number,y:number)=>new window.PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:x,clientY:y});
 const drag=(source:string,target:string,fraction:number,cancel?:'escape'|'pointercancel'|'blur'|'layout')=>{
  const from=document.querySelector(`[data-tab-id=${source}]`)!,to=document.querySelector(`[data-tab-id=${target}]`)!;
  const rect=to.parentElement!.getBoundingClientRect(),vertical=f.snapshot().preferences.layout==='vertical';
  const x=rect.x+(vertical?30:rect.width*fraction),y=rect.y+(vertical?rect.height*fraction:15);
  hit=to as any;from.dispatchEvent(pointer('pointerdown',-20,-20));to.dispatchEvent(pointer('pointermove',x,y));
  if(cancel==='escape')document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  if(cancel==='pointercancel')document.dispatchEvent(pointer('pointercancel',x,y));
  if(cancel==='blur')window.dispatchEvent(new window.Event('blur'));
  if(cancel==='layout')void f.port.request({type:'shell.set-chrome-layout',layout:{preset:'classic',side:'left',address:'top'}});
  to.dispatchEvent(pointer('pointerup',x,y));render();
 };
 try{
  drag('release','research',.5);expect(f.snapshot().tabs.find(t=>t.id==='release')?.parentId).toBe('research');
  drag('research','accessibility',.9);expect(f.snapshot().tabs.map(t=>t.id)).toEqual(['accessibility','research','release']);
  drag('release','accessibility',.1);expect(f.snapshot().tabs[0]?.id).toBe('release');expect(f.snapshot().tabs[0]?.parentId).toBeUndefined();
  for(const cancel of ['escape','pointercancel','blur'] as const){const before=f.snapshot();drag('release','research',.5,cancel);expect(f.snapshot()).toEqual(before);expect(document.querySelector('.split-drag-surface')?.hasAttribute('hidden')).toBe(true);}
  await f.port.request({type:'tab.pin',tabId:'release',value:true});render();const before=commands.length;drag('release','research',.5);expect(commands.length).toBe(before);
  await f.port.request({type:'tab.pin',tabId:'release',value:false});render();
  await f.port.request({type:'shell.set-chrome-layout',layout:{preset:'sidebar',side:'right',address:'bottom'}});const count=commands.length;drag('release','research',.5,'layout');expect(commands.length).toBe(count);
 }finally{stop();f.dispose();await window.happyDOM.close();}
});

test('cross-private group and reorder drops are rejected before issuing native commands',()=>{
 const f=createBirdFixture('vertical',canDropTab),tabs=f.snapshot().tabs.map((t,i)=>({...t,private:i===0}));
 for(const placement of ['before','inside','after'] as const)expect(canDropTab(tabs,'research','release',placement)).toBe(false);
});
