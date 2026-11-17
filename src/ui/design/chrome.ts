import type {ShellController} from '../../browser/controller';
import {observeTabMotion} from './tab-motion';
import {observePinLayout} from './pin-layout';
import {observeContour} from './contour';
import {observeOverflow} from './overflow';
import {mountWorkspaceSwitch} from './workspace-switch';
import '../preferences-primitives.css';
import './tabs.css';
import './toolbar.css';

/** The same chrome lifecycle is used by the native shell and deterministic demos. */
export function mountBrowserChrome(controller:ShellController){
 const shell=document.querySelector<HTMLElement>('.shell')!;
 const list=shell.querySelector<HTMLElement>('.tab-list')!;
 const tabs=shell.querySelector<HTMLElement>('.tabs')!;
 document.body.classList.add('haz-proposal','preferences-theme','haz-always-close');
 const motion=observeTabMotion(list),pins=observePinLayout(shell),spaces=mountWorkspaceSwitch(controller);
 const contour=observeContour(tabs,list,()=>shell.classList.contains('horizontal')&&!shell.classList.contains('wrap-tabs')?(()=>{const tab=shell.querySelector<HTMLElement>('.tab.active');return tab?.closest<HTMLElement>('.split-tab')??tab;})():null,()=>tabs.clientHeight-.5,.5);
 let axis=controller.state().layout==='vertical'||controller.state().wrapTabs;
 let overflow=observeOverflow(list,axis),frame=0;
 const appearance=()=>{
  const prefs=controller.state().browser.preferences;
  document.body.dataset.theme=prefs.theme??'dark';
  document.body.classList.toggle('haz-always-close',prefs.alwaysClose!==false);
  document.body.classList.toggle('haz-quiet-close',prefs.alwaysClose===false);
 };
 appearance();
 const stop=controller.source.subscribe(state=>{
  appearance();
  const next=state.layout==='vertical'||state.wrapTabs;
  if(next===axis)return;axis=next;cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{overflow();overflow=observeOverflow(list,axis);});
 });
 return()=>{cancelAnimationFrame(frame);stop();overflow();contour();spaces();pins();motion();document.body.classList.remove('haz-proposal','preferences-theme','haz-always-close','haz-quiet-close');};
}
