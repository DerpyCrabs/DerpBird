/** Tab overflow treatment. JS edge detection also works without scroll timelines. */
export function observeOverflow(list: HTMLElement, vertical = false) {
 const host=list.parentElement!;
 host.classList.add('haz-overflow-host');
 list.classList.add('haz-overflow');
 let scrollFrame=0,scrollTarget=0;
 const position=()=>vertical?list.scrollTop:list.scrollLeft;
 const maximum=()=>Math.max(0,vertical?list.scrollHeight-list.clientHeight:list.scrollWidth-list.clientWidth);
 const move=(delta:number,animate=true)=>{
  const from=position();scrollTarget=Math.max(0,Math.min(maximum(),(scrollFrame?scrollTarget:from)+delta));
  cancelAnimationFrame(scrollFrame);scrollFrame=0;
  const to=scrollTarget,start=performance.now();
  const set=(value:number)=>{if(vertical)list.scrollTop=value;else list.scrollLeft=value;};
  if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches){set(to);return;}
  const tick=(now:number)=>{const t=Math.min(1,(now-start)/280);set(from+(to-from)*(1-Math.pow(1-t,3)));list.dataset.scrollAnimating=String(t<1);scrollFrame=t<1?requestAnimationFrame(tick):0;};
  scrollFrame=requestAnimationFrame(tick);
 };
 const wheel=(event:WheelEvent)=>{
  if(vertical||event.ctrlKey)return;
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
  if(!delta)return;
  event.preventDefault();move(delta*(event.deltaMode===1?24:event.deltaMode===2?list.clientWidth:1),Math.abs(event.deltaY)>=Math.abs(event.deltaX));
 };
 list.addEventListener('wheel',wheel,{passive:false});
 const hiding=new Map<HTMLButtonElement,ReturnType<typeof setTimeout>>();
 const presence=(button:HTMLButtonElement,available:boolean,hovered=button.matches(':hover'))=>{
  const timer=hiding.get(button);if(timer)clearTimeout(timer);hiding.delete(button);
  if(available||hovered){button.dataset.present='true';return;}
  // Keep the element painted until its opacity transition finishes. Some engines
  // apply visibility immediately despite a CSS transition delay.
  hiding.set(button,setTimeout(()=>{button.dataset.present='false';hiding.delete(button);},matchMedia('(prefers-reduced-motion: reduce)').matches?0:180));
 };
 const buttons=(vertical?[]:[-1,1]).map(direction=>{
  const button=document.createElement('button');button.className=`haz-scroll ${direction<0?'previous':'next'}`;
  button.type='button';button.tabIndex=-1;button.dataset.present='false';button.style.setProperty('--haz-entrance',`${direction*4}px`);
  button.setAttribute('aria-label',`Scroll tabs ${vertical?(direction<0?'up':'down'):(direction<0?'left':'right')}`);
  const shape=vertical?(direction<0?'4 10 8 6 12 10':'4 6 8 10 12 6'):(direction<0?'10 4 6 8 10 12':'6 4 10 8 6 12');
  button.innerHTML=`<svg viewBox="0 0 16 16" aria-hidden="true"><polyline points="${shape}"/></svg>`;
  button.onpointerdown=e=>e.preventDefault();
  button.onmouseenter=()=>presence(button,button.getAttribute('aria-disabled')==='false',true);
  button.onmouseleave=()=>presence(button,button.getAttribute('aria-disabled')==='false',false);
  button.onclick=()=>{if(button.getAttribute('aria-disabled')==='true')return;
   move(direction*(vertical?list.clientHeight:list.clientWidth)*.65);};
  host.append(button);return button;
 });
 const track=vertical?document.createElement('div'):null;
 const thumb=track?document.createElement('div'):null;
 let drag:{y:number;scroll:number}|null=null;
 let idleTimer:ReturnType<typeof setTimeout>|undefined;
 const showScrollbar=()=>{
  if(!track)return;clearTimeout(idleTimer);track.dataset.scrolling='true';
  idleTimer=setTimeout(()=>{if(!drag)track.dataset.scrolling='false';},650);
 };
 const endDrag=()=>{drag=null;showScrollbar();};
 if(track&&thumb){
  track.className='haz-scroll-track';thumb.className='haz-scroll-thumb';track.append(thumb);host.append(track);
  track.setAttribute('aria-hidden','true');
  track.onpointerdown=event=>{
   if(event.button!==0)return;event.preventDefault();
   const rect=thumb.getBoundingClientRect();
   if(event.clientY<rect.top||event.clientY>rect.bottom)list.scrollTop+=(event.clientY<rect.top?-1:1)*list.clientHeight;
   drag={y:event.clientY,scroll:list.scrollTop};showScrollbar();track.setPointerCapture(event.pointerId);
  };
  track.onpointermove=event=>{if(!drag)return;const travel=track.clientHeight-thumb.offsetHeight;if(travel>0)list.scrollTop=drag.scroll+(event.clientY-drag.y)*maximum()/travel;};
  track.onpointerup=track.onpointercancel=endDrag;
  track.onlostpointercapture=endDrag;
 }
 let frame=0;
 const update=()=>{
  frame=0;const position=vertical?list.scrollTop:list.scrollLeft;
  const max=vertical?list.scrollHeight-list.clientHeight:list.scrollWidth-list.clientWidth;
  if(track&&thumb){
   track.hidden=max<=0;track.style.top=`${list.offsetTop}px`;track.style.left=`${list.offsetLeft+list.clientWidth-6}px`;track.style.height=`${list.clientHeight}px`;
   const height=Math.min(list.clientHeight,Math.max(24,list.clientHeight*list.clientHeight/list.scrollHeight));
   thumb.style.height=`${height}px`;thumb.style.transform=`translateY(${max>0?position/max*(list.clientHeight-height):0}px)`;
  }
  const before=position>1,after=position<max-1;
  list.dataset.before=String(before);list.dataset.after=String(after);list.dataset.axis=vertical?'vertical':'horizontal';
  buttons.forEach((b,i)=>{const available=i?after:before;b.setAttribute('aria-disabled',String(!available));presence(b,available);
   b.style.top=`${list.offsetTop+(vertical?(i?list.clientHeight-30:2):3)}px`;
   b.style.left=`${list.offsetLeft+(vertical?(list.clientWidth-28)/2:(i?list.clientWidth-31:3))}px`;
  });
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 let pointerSelecting=false;
 const pointerDown=()=>{pointerSelecting=true;};
 const pointerUp=()=>{pointerSelecting=false;};
 const reveal=(target:HTMLElement)=>{if(!target.matches('[role=tab]'))return;
  const box=list.getBoundingClientRect(),tab=(target.closest<HTMLElement>('.tab')??target).getBoundingClientRect();
  const start=vertical?tab.top-box.top:tab.left-box.left,end=vertical?tab.bottom-box.top:tab.right-box.left;
  const size=vertical?list.clientHeight:list.clientWidth;
  const delta=start<38?start-38:end>size-38?end-size+38:0;
  if(delta){cancelAnimationFrame(scrollFrame);scrollFrame=0;move(delta,true);}
 };
 const focus=(event:FocusEvent)=>{if(!pointerSelecting)reveal(event.target as HTMLElement);};
 const click=(event:MouseEvent)=>{const target=(event.target as HTMLElement).closest<HTMLElement>('[role=tab]');if(target)reveal(target);};
 list.addEventListener('pointerdown',pointerDown,true);document.addEventListener('pointerup',pointerUp);list.addEventListener('click',click);
 const resize=new ResizeObserver(schedule);resize.observe(list);
 const mutation=new MutationObserver(records=>{
  schedule();
  // Native shortcuts can activate a tab without moving DOM focus.
  for(const record of records){
   if(record.type==='attributes'&&record.oldValue!=='true'&&(record.target as HTMLElement).getAttribute('aria-selected')==='true')reveal(record.target as HTMLElement);
  }
 });mutation.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected'],attributeOldValue:true});
 list.addEventListener('scroll',schedule);list.addEventListener('scroll',showScrollbar);list.addEventListener('focusin',focus);update();
 return()=>{clearTimeout(idleTimer);list.removeEventListener('scroll',showScrollbar);track?.remove();hiding.forEach(clearTimeout);hiding.clear();cancelAnimationFrame(scrollFrame);list.removeEventListener('wheel',wheel);delete list.dataset.scrollAnimating;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();list.removeEventListener('scroll',schedule);list.removeEventListener('focusin',focus);list.removeEventListener('pointerdown',pointerDown,true);document.removeEventListener('pointerup',pointerUp);list.removeEventListener('click',click);buttons.forEach(b=>b.remove());list.classList.remove('haz-overflow');host.classList.remove('haz-overflow-host');};
}
