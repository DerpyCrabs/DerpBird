import './split-demo.css';
import {splitFor} from '@bird/browser/splits';
import type {createBirdFixture} from './fixture';
// Only page content is simulated; tabs, menus, dragging and divider use DerpBird.
export function mountSplitDemo(controller:any, conditions:any, fixture:ReturnType<typeof createBirdFixture>, articleOverrides?:Record<string,string>) {
 const surface=document.querySelector<HTMLElement>('#content-surface')!;
 const workspace=document.createElement('div');workspace.className='demo-pages';surface.append(workspace);
 const articles:Record<string,string>=articleOverrides??{
 research:`<div class="site-mast">FIELDNOTES <span>Design / Research</span></div><div class="article-eyebrow">WORKSPACE STUDIES · 014</div><h1>Reading notes</h1><p class="article-lead">Observations from this week’s research sessions.</p><div class="paper-art"><div class="paper-art-a"><i></i><i></i><i></i></div><div class="paper-art-b"><i></i><i></i><i></i></div><span>Research journal · November</span></div><h2>Session overview</h2><p>Participants reviewed the navigation structure and completed five common tasks. Most found the document they needed without using search.</p><blockquote>“I want to get back to the page I was just reading.”</blockquote><h2>Follow-up questions</h2><p>The next session will focus on returning to previous work, finding saved documents, and comparing information across sources.</p>`,
 accessibility:`<div class="site-mast">STUDIO <span>Project notebook</span></div><div class="article-eyebrow">PROJECT / WEBSITE REVIEW</div><h1>Accessibility review</h1><p class="article-lead">Review notes for the next website release.</p><div class="note-label">REVIEW CHECKLIST <span>3 / 5 complete</span></div><div class="checks"><label><input type="checkbox" checked> Check heading order</label><label><input type="checkbox" checked> Add image descriptions</label><label><input type="checkbox" checked> Verify text contrast</label><label><input type="checkbox"> Review form error messages</label><label><input type="checkbox"> Test keyboard navigation</label></div><div class="note-card"><b>Open question</b><p>Should the search field retain the previous query when returning from a result?</p></div><h2>Working notes</h2><textarea aria-label="Working notes" placeholder="Add a note…"></textarea>`,
 release:`<div class="site-mast">STUDIO <span>Release planning</span></div><div class="article-eyebrow">NEXT UP / NOVEMBER</div><h1>November release</h1><p class="article-lead">Milestones and owners for the next website update.</p><div class="note-card"><b>01 / Content review</b><p>Finalize the documentation and review the updated help pages.</p></div><div class="note-card"><b>02 / Quality assurance</b><p>Complete accessibility checks and resolve the remaining navigation issues.</p></div><div class="note-card"><b>03 / Release</b><p>Publish the approved changes after the final review.</p></div>`};

 const pages=new Map<string,HTMLElement>();
 function page(id:string){
  if(pages.has(id))return pages.get(id)!;
  const el=document.createElement('section');el.className='demo-page';el.dataset.id=id;
  el.innerHTML=`<article class="demo-article ${id}">${articles[id]??'<h1></h1><p class="article-lead"></p>'}</article>`;
  if(!articles[id]){const tab=fixture.snapshot().tabs.find(t=>t.id===id);el.querySelector('h1')!.textContent=tab?.title??'New tab';el.querySelector('p')!.textContent=tab?.url??'';}
  el.addEventListener('pointerdown',()=>controller.send({type:'tab.activate',tabId:id}));
  pages.set(id,el);return el;
 }
 function render(){
  const browser=fixture.snapshot(),split=splitFor(browser,browser.activeTabId);
  workspace.dataset.axis=split?.axis??'horizontal';workspace.dataset.split=String(!!split);
  workspace.style.setProperty('--ratio',String(split?.ratio??.5));
  const ids=split?[split.firstTabId,split.secondTabId]:browser.activeTabId?[browser.activeTabId]:[];
  workspace.replaceChildren(...ids.map(page));
  pages.forEach((element,id)=>element.dataset.active=String(id===browser.activeTabId));
 }
 const stop=fixture.port.subscribe(render);
 render();return()=>{stop();workspace.remove();};
}
