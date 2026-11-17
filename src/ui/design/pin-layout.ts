/** Balance rows rather than leaving a single orphan after a full row. */
export function pinRows(count:number,capacity=6):number[]{
 if(count<=0)return [];
 const rows=Math.ceil(count/Math.max(1,capacity)),base=Math.floor(count/rows),extra=count%rows;
 return Array.from({length:rows},(_,i)=>base+(i<extra?1:0));
}
export function observePinLayout(shell:HTMLElement){
 let host:HTMLElement|null=null;
 const update=()=>{
  const next=shell.querySelector<HTMLElement>('.pinned-tabs');
  if(next!==host){if(host)resize.unobserve(host);host=next;if(host)resize.observe(host);}
  if(!host)return;
  const capacity=Math.max(1,Math.min(6,Math.floor((host.clientWidth+4)/32)));
  const rows=pinRows(host.children.length,capacity),columns=rows[0]??1;
  host.style.setProperty('--haz-pin-basis',`${Math.max(0,(host.clientWidth-4*(columns-1))/columns-.02)}px`);
  host.dataset.pinRows=rows.join('+');
 };
 const resize=new ResizeObserver(update);
 const mutation=new MutationObserver(update);mutation.observe(shell,{subtree:true,childList:true});
 update();return()=>{resize.disconnect();mutation.disconnect();};
}
