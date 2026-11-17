let contourId=0;
/** A single connected outline, animated between measured tab positions. */
export function observeContour(host: HTMLElement, list: HTMLElement, active: () => HTMLElement | null, baseline: () => number, top = 6) {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.classList.add('haz-contour');svg.setAttribute('aria-hidden','true');
 host.prepend(svg);
 if(host.classList.contains('tabs')){
  const frame=document.createElementNS(svg.namespaceURI,'rect');frame.classList.add('haz-tab-frame');frame.setAttribute('x','.5');frame.setAttribute('y','.5');frame.setAttribute('rx','12');svg.append(frame);
 }
 const clipId=`haz-contour-clip-${++contourId}`;
 const defs=document.createElementNS(svg.namespaceURI,'defs');
 const clip=document.createElementNS(svg.namespaceURI,'clipPath');clip.id=clipId;defs.append(clip);svg.append(defs);
 let frame=0,last:HTMLElement|null=null,shown:{x:number;width:number}|null=null;
 let motion:{from:{x:number;width:number};to:{x:number;width:number};start:number}|null=null;
 const draw=(now:number)=>{
  frame=0;const tab=active(),box=host.getBoundingClientRect(),rect=tab?.getBoundingClientRect();
  const w=host.clientWidth,h=host.clientHeight,y=baseline();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const outer=svg.querySelector('.haz-tab-frame');outer?.setAttribute('width',String(w-1));outer?.setAttribute('height',String(h+12));
  if(rect){
   const target={x:rect.left-box.left-host.clientLeft,width:rect.width};
   if(list.dataset.tabLayoutAnimating==='true'){motion=null;shown=target;}
   else if(tab!==last&&shown&&!matchMedia('(prefers-reduced-motion: reduce)').matches)motion={from:shown,to:target,start:now};
   if(motion){motion.to=target;const t=Math.min(1,(now-motion.start)/240),e=1-Math.pow(1-t,3);shown={x:motion.from.x+(target.x-motion.from.x)*e,width:motion.from.width+(target.width-motion.from.width)*e};if(t===1)motion=null;}
   else shown=target;
  }else{shown=null;motion=null;}
  last=tab;
  const x=shown?.x??0,end=x+(shown?.width??0),r=Math.min(12,(y-top)/2);
  const shape=shown&&end>0&&x<w?`H ${x-r} Q ${x} ${y} ${x} ${y-r} V ${top+r} Q ${x} ${top} ${x+r} ${top} H ${end-r} Q ${end} ${top} ${end} ${top+r} V ${y-r} Q ${end} ${y} ${end+r} ${y}`:'';
  // Replace the path so Ladybird recomputes its painted bounds when the contour
  // changes from an offscreen flat baseline back to a visible selected tab.
  const path=document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d',`M -400 ${y} ${shape} H ${w+400} V ${h+2} H -400 Z`);
  const viewport=list.getBoundingClientRect();
  const left=Math.max(0,viewport.left-box.left-host.clientLeft),right=Math.min(w,viewport.right-box.left-host.clientLeft);
  const region=document.createElementNS(svg.namespaceURI,'rect');
  region.setAttribute('x',String(left));region.setAttribute('y','0');
  region.setAttribute('width',String(Math.max(0,right-left)));region.setAttribute('height',String(h+2));
  clip.replaceChildren(region);path.setAttribute('clip-path',`url(#${clipId})`);
  svg.querySelector('path')?.remove();svg.querySelectorAll('line').forEach(line=>line.remove());
  for(const [start,end] of [[0,left],[right,w]]){
   const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1',String(start));line.setAttribute('x2',String(end));line.setAttribute('y1',String(y));line.setAttribute('y2',String(y));line.setAttribute('stroke','var(--pref-line, #3b3b40)');line.setAttribute('stroke-width','1');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);
  }
  svg.append(path);
  host.dataset.contourAnimating=String(!!motion);
  if(motion||list.dataset.tabLayoutAnimating==='true')frame=requestAnimationFrame(draw);
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};
 const resize=new ResizeObserver(schedule);resize.observe(host);resize.observe(list);
 const mutation=new MutationObserver(schedule);mutation.observe(list,{subtree:true,attributes:true,attributeFilter:['aria-selected','class','data-tab-layout-animating'],childList:true});
 list.addEventListener('scroll',schedule);schedule();
 return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();list.removeEventListener('scroll',schedule);svg.remove();delete host.dataset.contourAnimating;};
}
