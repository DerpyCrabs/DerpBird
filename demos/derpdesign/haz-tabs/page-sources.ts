import {openPageSources} from '@bird/ui/PageSources';
import {openStyleManager} from '@bird/ui/StyleManager';
import {openScriptManager} from '@bird/ui/ScriptManager';
import {parseUserScript} from '@bird/browser/user-scripts';
import type {StyleSnapshot} from '@bird/browser/style-protocol';
import type {ScriptSnapshot} from '@bird/browser/script-protocol';
import type {SourceKind,PageSources} from '@bird/browser/page-sources';
import type {ShellController} from '@bird/browser/controller';

/** In-memory native boundary; the popovers and managers are the product components. */
export function createDemoPageSources(controller:ShellController){
 let styles:StyleSnapshot={revision:1,items:[{id:'reading',name:'Reading typography',enabled:true,source:'body { line-height: 1.6; }',sections:[{conditions:[],css:'body { line-height: 1.6; }'}]},{id:'contrast',name:'Higher contrast',enabled:false,source:'body { color: #eee; }',sections:[{conditions:[],css:'body { color: #eee; }'}]}]};
 let scripts:ScriptSnapshot={revision:1,items:[['copy','Copy page title',true],['links','Clean tracking links',false]].map(([id,name,enabled])=>{
  const source=`// ==UserScript==\n// @name ${name}\n// @match https://example.test/*\n// @grant none\n// ==/UserScript==\n`;
  return{id:String(id),name:String(name),enabled:Boolean(enabled),source,fileAccessGranted:false,metadata:parseUserScript(source)};
 })};
 let popup:ReturnType<typeof openPageSources>|undefined,manager:{dispose:()=>void}|undefined;
 const host=()=>document.querySelector<HTMLElement>('#style-manager-host')!;
 const page=():PageSources=>{const state=controller.state(),tab=state.browser.tabs.find(t=>t.id===state.browser.activeTabId)!;return{tabId:tab.id,url:tab.url,styleRevision:styles.revision,scriptRevision:scripts.revision,styles:styles.items,scripts:scripts.items};};
 const refresh=()=>controller.setPageSources(page());
 const manage=(kind:SourceKind)=>{
  popup?.close();manager?.dispose();
  manager=kind==='styles'?openStyleManager(host(),{list:async()=>structuredClone(styles),replace:async snapshot=>{styles={...snapshot,revision:styles.revision+1};refresh();return structuredClone(styles);}},()=>{manager=undefined}):openScriptManager(host(),{list:async()=>structuredClone(scripts),replace:async snapshot=>{scripts={...snapshot,revision:scripts.revision+1};refresh();return structuredClone(scripts);}},()=>{manager=undefined});
 };
 const open=(kind:SourceKind)=>{
  popup?.close();manager?.dispose();manager=undefined;
  popup=openPageSources(host(),{page:async()=>page(),toggle:async(_,kind,id,enabled)=>{
   if(kind==='styles')styles={revision:styles.revision+1,items:styles.items.map(item=>item.id===id?{...item,enabled}:item)};
   else scripts={revision:scripts.revision+1,items:scripts.items.map(item=>item.id===id?{...item,enabled}:item)};
   return page();
  }},kind,()=>{popup=undefined},value=>controller.setPageSources(value),()=>manage(kind),()=>controller.send({type:'tab.reload',tabId:controller.state().browser.activeTabId!}));
 };
 return{open,manage,refresh,closePopup:()=>popup?.close(),dispose(){popup?.dispose();manager?.dispose();}};
}
