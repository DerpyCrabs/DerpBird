type Position={element:HTMLElement;tab:HTMLElement;icon:HTMLElement|null;rect:DOMRect;iconRect:DOMRect|null;pinned:boolean;width:number};
/** Animate the actual tab nodes across the pinned/regular DOM groups. */
export function observeTabMotion(list:HTMLElement){
 let positions=new Map<string,Position>(),frame=0,pending=0;
 let measuredScrollX=list.scrollLeft,measuredScrollY=list.scrollTop;
 let restore:Array<()=>void>=[];
 let observed=new Set<HTMLElement>();
 const measure=()=>{
  measuredScrollX=list.scrollLeft;measuredScrollY=list.scrollTop;
  const result=new Map<string,Position>();
  list.querySelectorAll<HTMLElement>('[role=tab][data-tab-id]').forEach(button=>{
   const tab=button.closest<HTMLElement>('.tab')!,element=tab.closest<HTMLElement>('.tab-unit')!,icon=tab.querySelector<HTMLElement>('.tab-icon');
   result.set(button.dataset.tabId!,{element,tab,icon,rect:element.getBoundingClientRect(),iconRect:icon?.getBoundingClientRect()??null,pinned:!!element.closest('.pinned-tabs'),width:tab.getBoundingClientRect().width});
  });
  const elements=new Set([...result.values()].map(p=>p.element));
  for(const element of observed)if(!elements.has(element))resize.unobserve(element);
  for(const element of elements)if(!observed.has(element))resize.observe(element);
  observed=elements;return result;
 };
 const finish=(remeasure=true)=>{cancelAnimationFrame(frame);frame=0;restore.forEach(fn=>fn());restore=[];list.dataset.tabLayoutAnimating='false';if(remeasure)positions=measure();};
 const update=()=>{
  pending=0;translatePositions();const next=measure();
  const changed=[...next].filter(([id,p])=>positions.has(id)&&positions.get(id)!.pinned!==p.pinned);
  if(!changed.length||matchMedia('(prefers-reduced-motion: reduce)').matches){positions=next;return;}
  const previous=positions;finish(false);
  const scrollX=list.scrollLeft,scrollY=list.scrollTop;
  const animated:Array<{current:Position;old:Position;morph:boolean;pinChange:boolean}>=[];
  const seen=new Set<HTMLElement>();
  for(const [id,current] of next){
   const old=previous.get(id);if(!old||seen.has(current.element))continue;seen.add(current.element);
   const pinChange=old.pinned!==current.pinned,morph=pinChange||Math.abs(old.width-current.width)>.5;
   if(!morph&&Math.abs(old.rect.x-current.rect.x)<.5&&Math.abs(old.rect.y-current.rect.y)<.5)continue;
   animated.push({current,old,morph,pinChange});
   const nodes=[current.element,...(morph?[current.tab,current.icon,current.tab.querySelector<HTMLElement>('.tab-title'),current.tab.querySelector<HTMLElement>('.close-tab')]:[])].filter(Boolean) as HTMLElement[];
   nodes.forEach(node=>{const css=node.style.cssText;restore.push(()=>{node.style.cssText=css;});});
   if(morph){current.element.style.position='relative';current.element.style.zIndex='2';if(!current.tab.classList.contains('active')&&list.closest('.shell.horizontal'))current.tab.style.background='var(--haz-tab-bg)';current.tab.style.flex='none';current.tab.style.minWidth='0';const title=current.tab.querySelector<HTMLElement>('.tab-title');if(title&&pinChange)title.style.display='block';}
  }
  list.dataset.tabLayoutAnimating='true';const start=performance.now();
  const tick=(now:number)=>{
   const t=Math.min(1,(now-start)/280),e=1-Math.pow(1-t,3);
   animated.forEach(({current,old,morph,pinChange})=>{
    current.element.style.transform=`translate(${(old.rect.x-current.rect.x)*(1-e)}px,${(old.rect.y-current.rect.y)*(1-e)}px)`;
    if(morph){
     current.tab.style.width=`${old.width+(current.width-old.width)*e}px`;
     const opacity=current.pinned?1-e:e;
     if(pinChange)for(const node of current.tab.querySelectorAll<HTMLElement>('.tab-title,.close-tab'))node.style.opacity=String(opacity);
     if(current.icon&&old.iconRect&&current.iconRect)current.icon.style.transform='none';
    }
   });
   // Finish all layout-affecting writes before measuring any icon, then apply
   // the transform-only corrections together. At most one layout flush per tick.
   const icons=animated.filter(({current,old,morph})=>morph&&current.icon&&old.iconRect&&current.iconRect);
   const actual=icons.map(({current})=>current.icon!.getBoundingClientRect());
   const dx=list.scrollLeft-scrollX,dy=list.scrollTop-scrollY;
   icons.forEach(({current,old},i)=>{
    const x=old.iconRect!.x+(current.iconRect!.x-old.iconRect!.x)*e-dx;
    const y=old.iconRect!.y+(current.iconRect!.y-old.iconRect!.y)*e-dy;
    current.icon!.style.transform=`translate(${x-actual[i]!.x}px,${y-actual[i]!.y}px)`;
   });
   if(t<1)frame=requestAnimationFrame(tick);else finish();
  };
  tick(start);
 };
 const schedule=()=>{if(!pending)pending=requestAnimationFrame(update);};
 // Text/icon changes cannot reparent a tab. Only structural changes to tab
 // containers need a fresh animation snapshot. ResizeObserver covers sizing.
 const mutation=new MutationObserver(records=>{
  const structural=(value:string)=>value.split(/\s+/).filter(name=>['tree-child','tree-root','split-tab','pinned-tab-unit'].includes(name)).sort().join(' ');
  if(records.some(record=>record.type==='attributes'
   ? structural(record.oldValue??'')!==structural((record.target as Element).getAttribute('class')??'')
   : record.target===list||(record.target as Element).matches?.('.pinned-tabs,.tab-unit')))schedule();
 });mutation.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
 const refresh=()=>{if(!frame&&!pending)positions=measure();};
 const resize=new ResizeObserver(refresh);resize.observe(list);
 const translatePositions=()=>{
  // Scrolling translates cached viewport coordinates without changing layout.
  const dx=list.scrollLeft-measuredScrollX,dy=list.scrollTop-measuredScrollY;
  for(const p of positions.values()){
   p.rect=new DOMRect(p.rect.x-dx,p.rect.y-dy,p.rect.width,p.rect.height);
   if(p.iconRect)p.iconRect=new DOMRect(p.iconRect.x-dx,p.iconRect.y-dy,p.iconRect.width,p.iconRect.height);
  }
  measuredScrollX=list.scrollLeft;measuredScrollY=list.scrollTop;
 };
 positions=measure();
 return()=>{mutation.disconnect();resize.disconnect();cancelAnimationFrame(pending);finish(false);delete list.dataset.tabLayoutAnimating;};
}
