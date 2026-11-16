import { mountLayoutSettings } from './layout-settings';
import type { ShellController, ChromeLayout } from '@bird/browser/controller';
import type { createBirdFixture } from './fixture';
import './layout-demo.css';
export async function mountLayoutDemo(controller: ShellController, conditions: Record<string, unknown>, fixture: ReturnType<typeof createBirdFixture>) {
 const arrangement:ChromeLayout={preset:(conditions.preset??'classic') as ChromeLayout['preset'],side:conditions.side==='right'?'right':'left',address:conditions.address==='bottom'?'bottom':'top'};
 controller.setChromeLayout(arrangement);
 await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
 const page=document.createElement('article');page.className='layout-example-page';
 page.innerHTML='<nav><b>Fieldnotes</b><span>Research library</span></nav><div class="fieldnote-body"><small>DESIGN / RESEARCH</small><h1>A little more room<br>to think.</h1><p>Collect ideas. Follow a thread. Keep the useful things close.</p><div class="fieldnote-rule"></div><h2>Your space, your pace</h2><p>The best tools leave room for the work. A familiar place for your tabs, a clear way to get somewhere, and the whole page ahead of you.</p><div class="fieldnote-tiles"><section><span>01</span><h3>Find your focus</h3><p>One idea at a time.</p></section><section><span>02</span><h3>Keep exploring</h3><p>Pick up where you left off.</p></section></div></div>';
 document.querySelector('#content-surface')!.append(page);
 let settings:ReturnType<typeof mountLayoutSettings>|undefined;
 const showPage=()=>{const state=fixture.snapshot();const open=state.tabs.find(tab=>tab.id===state.activeTabId)?.url==='about:settings';page.hidden=open;if(open&&!settings)settings=mountLayoutSettings(document.querySelector('#content-surface')!,controller);if(settings){settings.frame.style.display=open?'block':'none';if(open)settings.publish();}};
 const unsubscribe=fixture.port.subscribe(showPage);showPage();
 if(conditions.settings){controller.openPage('settings');await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));await settings?.ready;}
 if(conditions.palette){controller.openAddressPalette();controller.editAddress('accessibility');}
 return()=>{unsubscribe();settings?.dispose();page.remove();};
}
