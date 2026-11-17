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
  const width=host.clientWidth;
  const capacity=Math.max(1,Math.min(6,Math.floor((width+4)/32)));
  const rows=pinRows(host.children.length,capacity),columns=rows[0]??1;
  const basis=`${Math.max(0,(width-4*(columns-1))/columns-.02)}px`,signature=rows.join('+');
  if(host.style.getPropertyValue('--haz-pin-basis')!==basis)host.style.setProperty('--haz-pin-basis',basis);
  if(host.dataset.pinRows!==signature)host.dataset.pinRows=signature;
 };
 const resize=new ResizeObserver(update);
 const mutation=new MutationObserver(records=>{
  if(records.some(record=>record.target===host||(record.target as Element).matches?.('.tab-list')||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&((node as Element).matches('.pinned-tabs,.tab-list')||(node as Element).querySelector('.pinned-tabs')))))update();
 });mutation.observe(shell,{subtree:true,childList:true});
 update();return()=>{resize.disconnect();mutation.disconnect();};
}
