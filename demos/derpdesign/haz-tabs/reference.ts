import {observeContour} from './contour';
import {observeOverflow} from './overflow';
import './tabs.css';
import './reference.css';
/** One outline owns the active tab and panel; no masking patches over adjoining borders. */
export function mountReference(root:HTMLElement){
 root.innerHTML='<div class="haz-reference"><section class="haz-card"><div class="haz-reference-strip"><div class="haz-reference-list" role="tablist" aria-label="Project"></div></div><div id="haz-panel" role="tabpanel" tabindex="0"></div></section></div>';
 const card=root.querySelector<HTMLElement>('.haz-card')!;
 const list=root.querySelector<HTMLElement>('[role=tablist]')!,panel=root.querySelector<HTMLElement>('[role=tabpanel]')!;
 const names=['Overview','Activity','Members','Files','Reports','Settings','Billing','Integrations','Security','Webhooks'];
 const copy=['The redesign ships in June.','The latest changes are ready for review.','Everyone has a place on the team.','All your project files, together.','A clearer picture of your progress.','The project is private.','Your next invoice arrives in June.','Connect the tools you already use.','Two-factor authentication is enabled.','Keep your services in sync.'];
 let selected=0;
 const select=(index:number)=>{selected=index;list.querySelectorAll<HTMLButtonElement>('button').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;});panel.textContent=copy[index];panel.setAttribute('aria-labelledby',`haz-tab-${index}`);};
 names.forEach((name,i)=>{const b=document.createElement('button');b.id=`haz-tab-${i}`;b.setAttribute('role','tab');b.setAttribute('aria-controls','haz-panel');b.textContent=name;b.onclick=()=>select(i);b.onkeydown=e=>{const next=e.key==='ArrowRight'?(i+1)%names.length:e.key==='ArrowLeft'?(i+names.length-1)%names.length:e.key==='Home'?0:e.key==='End'?names.length-1:-1;if(next<0)return;e.preventDefault();select(next);(list.children[next] as HTMLElement).focus();};list.append(b);});select(0);
 const outline=observeContour(card,list,()=>list.children[selected] as HTMLElement,()=>48,.5);
 const cleanup=observeOverflow(list);return()=>{outline();cleanup();root.replaceChildren();};
}
