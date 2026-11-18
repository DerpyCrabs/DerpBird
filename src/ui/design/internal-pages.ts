import {isNewTabPage} from '../../browser/protocol';
import type {ShellController} from '../../browser/controller';
import {mountBrowserPages} from './BrowserPages';

/** Internal pages run in the trusted shell; ordinary sites remain native surfaces. */
export function mountInternalPages(controller:ShellController){
 let current='',dispose:(()=>void)|undefined;
 const surface=document.querySelector<HTMLElement>('#content-surface')!;
 const update=()=>{
  const state=controller.state();
  const tab=state.browser.tabs.find(t=>t.id===state.browser.activeTabId);
  // Split content remains owned by the native split renderer.
  const split=state.browser.splits?.some(s=>s.firstTabId===tab?.id||s.secondTabId===tab?.id);
  const page=!split&&isNewTabPage(tab)?'start':!split&&tab?.url==='about:settings'?'appearance':'';
  const key=page?`${tab?.id}:${page}`:'';
  if(key===current)return;
  current=key;dispose?.();dispose=undefined;
  surface.toggleAttribute('data-internal-page',!!page);
  if(page==='appearance')dispose=mountBrowserPages(controller,{initialPage:page,onOpenSettings:()=>controller.openPage('settings'),onOpenStart:()=>controller.navigate('about:newtab'),onOpenAllSettings:()=>controller.navigate('about:settings#advanced')});
 };
 const stop=controller.source.subscribe(update);update();
 return()=>{stop();dispose?.();surface.removeAttribute('data-internal-page');};
}
