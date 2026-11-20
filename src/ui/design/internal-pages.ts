import {isNewTabPage} from '../../browser/protocol';
import type {ShellController} from '../../browser/controller';

/** Only the blank start surface belongs to the shell. Settings is a native WebUI. */
export function mountInternalPages(controller:ShellController){
 const surface=document.querySelector<HTMLElement>('#content-surface')!;
 const update=()=>{
  const state=controller.state();
  const tab=state.browser.tabs.find(t=>t.id===state.browser.activeTabId);
  // Split content remains owned by the native split renderer.
  const split=state.browser.splits?.some(s=>s.firstTabId===tab?.id||s.secondTabId===tab?.id);
  surface.toggleAttribute('data-internal-page', !split && isNewTabPage(tab));
 };
 const stop=controller.source.subscribe(update);update();
 return()=>{stop();surface.removeAttribute('data-internal-page');};
}
