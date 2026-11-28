import {observeSplitInteractions} from '@bird/browser/splits';
import {observeSidebarResize} from '@bird/browser/sidebar-resize';
import {observeShellDismissal} from '@bird/browser/shell-interaction';
import {focusAddress} from '@bird/browser/address-focus';
import {mount} from 'effectweb';
import {canDropTab} from '@bird/browser/tab-tree';
import {createBirdFixture} from './fixture';
import {createController} from '@bird/browser/controller';
import {shellView} from '@bird/ui/Shell';
import {openProxyManager} from '@bird/ui/ProxyManager';
import {createDemoPageSources} from './haz-tabs/page-sources';
import {createProxyFixture} from './proxy-fixture';
import '@bird/style.css';
import {runScenario} from '@derpdesign/harness';
runScenario(async ({conditions})=>{
 if(typeof conditions.collection==='string')return (await import('./collections/pages')).mountCollection(document.querySelector('#app')!,conditions.collection);
 if(typeof conditions.settingsStudy==='string')return (await import('./settings-study/study')).mountStudy(document.querySelector('#app')!,conditions.settingsStudy);
 if(conditions.hazPinExamples)return (await import('./haz-tabs/pin-examples')).mountPinExamples(document.querySelector('#app')!);
 if(conditions.hazReference)return (await import('./haz-tabs/reference')).mountReference(document.querySelector('#app')!);
 if(conditions.devtools){const [{mountDevTools},{devToolsTransport},{connectDevTools}]=await Promise.all([import('@bird/devtools/DevTools'),import('./devtools-fixture'),import('@bird/devtools/native-port')]);const port=(await connectDevTools(devToolsTransport(conditions.large===true)))!;const demo=mountDevTools(document.querySelector('#app')!,port,conditions.panel as any);return()=>{demo.dispose();port.dispose();};}
 const fixture=createBirdFixture(conditions.layout==='horizontal'?'horizontal':'vertical',canDropTab);
 if(conditions.downloadMenu && conditions.layout==='compact'){
  await fixture.port.request({type:'shell.set-chrome-layout',layout:{preset:'compact',side:'left',address:'top'}});
  await fixture.port.request({type:'shell.set-sidebar-width',width:290});
 }
 if(conditions.splitDemo){await fixture.port.request({type:'tab.split',tabId:'accessibility',targetId:'research',edge:conditions.axis==='vertical'?'bottom':'right'});await fixture.port.request({type:'tab.activate',tabId:'research'});}
 let tools: {dispose():void}|undefined;
 const openTools=async()=>{
  if(tools)return;
  const [{mountDevTools},{devToolsTransport},{connectDevTools}]=await Promise.all([import('@bird/devtools/DevTools'),import('./devtools-fixture'),import('@bird/devtools/native-port')]);
  const surface=document.querySelector<HTMLElement>('#content-surface')!;
  const container=document.createElement('div');container.style.cssText='position:absolute;inset:0;display:flex;min-height:0';surface.append(container);
  const page=document.createElement('div');page.style.cssText='flex:1;min-width:100px;min-height:100px;padding:24px;background:#eef1f3;color:#253238;font:16px system-ui';
  const card=document.createElement('button');card.textContent='DerpBird project';card.style.cssText='padding:20px;background:#d3e0db;color:#253238;border:1px solid #9cbaad';page.append(card);
  const host=document.createElement('div');
  const dock=(position:string)=>{host.style.cssText='min-width:360px;min-height:180px;border:1px solid #454d49;overflow:hidden';container.style.flexDirection=position==='bottom'?'column':'row';
   if(position==='window'){host.style.cssText+=';position:absolute;inset:35px;z-index:200';container.append(page,host);}
   else{host.style.flex=position==='bottom'?'0 0 50%':'0 0 48%';host.style.resize=position==='bottom'?'vertical':'horizontal';container.replaceChildren(...(position==='left'?[host,page]:[page,host]));}
  };
  dock('right');
  let pendingPick:(()=>void)|undefined;
  card.onclick=()=>{const done=pendingPick;pendingPick=undefined;card.style.outline='';done?.();};
  const port=(await connectDevTools(devToolsTransport(false,{dock,dismiss:()=>{queueMicrotask(()=>{tools?.dispose();tools=undefined;});},pick:done=>{if(pendingPick){pendingPick=undefined;card.style.outline='';}else{pendingPick=done;card.style.outline='2px solid #7195bc';}}})))!;
  const ui=mountDevTools(host,port,'Elements');tools={dispose(){ui.dispose();port.dispose();container.remove();}};
 };
 const proxyFixture=conditions.proxyDemo?createProxyFixture(conditions):undefined;
 let downloads: Awaited<ReturnType<typeof import('./collections/download-menu').mountDownloads>> | undefined;
 const port={...fixture.port,request:async(command:any)=>{if(command.type==='browser.open-page' && command.page==='downloads' && downloads){downloads.open();return;}if(command.type==='tab.inspect'){await openTools();return;}if(command.type==='tab.reload')proxyFixture?.reload();const result=await fixture.port.request(command);if(command.type==='tab.create'&&!command.url)focusAddress(document,controller);return result;}};
 let proxy:any={revision:1,active:'system',options:{schemaVersion:2,'+Office':{name:'Office',profileType:'FixedProfile',color:'#6b94c4',fallbackProxy:{scheme:'http',host:'proxy.example.test',port:8080},bypassList:[]}}};
 let manager:any;
 const show=()=>{if(manager){manager.toggle();return;}manager=openProxyManager(document.querySelector('#style-manager-host')!,proxyFixture?.port??{get:async()=>structuredClone(proxy),replace:async(s:any)=>{proxy={...structuredClone(s),revision:proxy.revision+1};return structuredClone(proxy)}},()=>{manager=undefined},'https://example.test/0')};
 if(conditions.workspaceDemo)fixture.enableWorkspaces(conditions.singleDefault===true,conditions.pinCount===9?9:3);
 if(conditions.hazProposal){
  if(!conditions.shortTabStrip)fixture.seedReadingTabs(['Tabs UI · Diego Haz','Scrollable interfaces','Ariakit components','Keyboard navigation','Focus and selection','Sidebar explorations','Design principles','Interaction details','Motion guidelines','Color and contrast','Typography notes','Component anatomy','Browser workspaces','Progressive disclosure','Touch target sizes','Release checklist','Team handbook','Reading list']);
  if(conditions.hazSplit)await fixture.port.request({type:'tab.split',tabId:'accessibility',targetId:'research',edge:conditions.hazSplit==='vertical'?'bottom':'right'});
  if(conditions.hazChildren){
   for(const [tabId,targetId] of [['reading-1','research'],['reading-2','research'],['reading-3','research'],['reading-4','accessibility'],['reading-5','accessibility']])await fixture.port.request({type:'tab.tree-move',tabId,targetId,placement:'inside'});
  }
  await fixture.port.request({type:'tab.activate',tabId:conditions.hazChildren&&!conditions.hazSplit?'reading-2':'research'});
 }
 const controller=createController(port);
 const toolStudy=conditions.toolStudy?(await import('./settings-study/sources')).createSourceLibraries(controller):undefined;
 const sources=toolStudy??createDemoPageSources(controller);
 const stopMenuWatch=controller.source.subscribe(state=>{if(state.panel==='menu')sources.closePopup();});
 const passwords=conditions.passwordStudy?(await import('./passwords/demo')).passwordStudy():undefined;
 const mounted=mount(document.querySelector('#app')!,shellView(controller,sources?()=>sources.manage('styles'):undefined,sources?()=>sources.manage('scripts'):undefined,passwords?.open,undefined,undefined,show,sources?.open),controller.source);
 await controller.ready;
 sources?.refresh();
 const beginTabDrag = conditions.interactiveTabDrag
  ? (await import('@bird/ui/design/tab-drag')).tabDragPreview(controller)
  : undefined;
 const stopInteractions=observeSplitInteractions(document,controller,beginTabDrag,fixture.moveToWorkspace);
 const stopResize=observeSidebarResize(document,controller.previewSidebarWidth,controller.setSidebarWidth);
 const stopDismissal=observeShellDismissal({deactivate:()=>controller.blurAddress()});
 const focusKey=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='l'){event.preventDefault();focusAddress(document,controller);}};
 document.addEventListener('keydown',focusKey);
 const layoutDemo = conditions.layoutDemo && !conditions.hazProposal ? await (await import('./layout-demo')).mountLayoutDemo(controller, conditions, fixture) : undefined;
 if(conditions.hazProposal)controller.setChromeLayout({preset:(conditions.preset??'sidebar') as any,side:'left',address:'top'});
 const browserUI=conditions.hazProposal?(await import('./haz-tabs/proposal')).mountProposal(controller,conditions,fixture):(await import('@bird/ui/design/chrome')).mountBrowserChrome(controller);
 if(conditions.workspaceEdit)controller.openWorkspaceEditor(controller.state().browser.workspaces?.active);
 if(conditions.workspaceCreate)controller.openWorkspaceEditor();
 const activityDemo = conditions.aiActivity ? await (async()=>{await import('./ai-activity/demo.css');const {mountActivityDemo}=await import('./ai-activity/demo');return mountActivityDemo(document.querySelector<HTMLElement>('#content-surface')!,{time:typeof conditions.aiTime==='number'?conditions.aiTime:undefined});})() : undefined;
 const splitDemo = conditions.splitDemo || toolStudy || passwords || conditions.downloadMenu ? (await import('./split-demo')).mountSplitDemo(controller,conditions,fixture) : undefined;
 if(conditions.downloadMenu)downloads=(await import('./collections/download-menu')).mountDownloads(conditions.showDownloads===true, conditions.emptyDownloads===true);
 const stopSettingsTab=toolStudy?(await import('./settings-study/study')).connectSettingsTab(controller):undefined;
 if(toolStudy && conditions.toolStudy!=='toolbar')toolStudy.manage(conditions.toolStudy==='styles'?'styles':'scripts',String(conditions.toolStudy));
 if(conditions.proxyDemo)show();
 const stopGallery=typeof conditions.dialogGroup==='string'?(await import('./dialogs/gallery')).mountGallery(conditions.dialogGroup,controller,fixture.setDialog):undefined;
 passwords?.open();
 if(conditions.manager)show();
 return()=>{stopGallery?.();passwords?.dispose();downloads?.dispose();stopSettingsTab?.();stopMenuWatch();sources.dispose();browserUI();stopInteractions();stopResize();stopDismissal();document.removeEventListener('keydown',focusKey);layoutDemo?.();activityDemo?.();tools?.dispose();splitDemo?.();manager?.dispose();mounted.dispose();void controller.close();fixture.dispose()};
});
