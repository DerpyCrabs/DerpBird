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
import {createProxyFixture} from './proxy-fixture';
import '@bird/style.css';
import {runScenario} from '@derpdesign/harness';
runScenario(async ({conditions})=>{
 if(conditions.devtools){const [{mountDevTools},{devToolsTransport},{connectDevTools}]=await Promise.all([import('@bird/devtools/DevTools'),import('./devtools-fixture'),import('@bird/devtools/native-port')]);const port=(await connectDevTools(devToolsTransport(conditions.large===true)))!;const demo=mountDevTools(document.querySelector('#app')!,port,conditions.panel as any);return()=>{demo.dispose();port.dispose();};}
 const fixture=createBirdFixture(conditions.layout==='horizontal'?'horizontal':'vertical',canDropTab);
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
 const port={...fixture.port,request:async(command:any)=>{if(command.type==='tab.inspect'){await openTools();return;}if(command.type==='tab.reload')proxyFixture?.reload();return fixture.port.request(command);}};
 let proxy:any={revision:1,active:'system',options:{schemaVersion:2,'+Office':{name:'Office',profileType:'FixedProfile',color:'#6b94c4',fallbackProxy:{scheme:'http',host:'proxy.example.test',port:8080},bypassList:[]}}};
 let manager:any;
 const show=()=>{if(manager){manager.toggle();return;}manager=openProxyManager(document.querySelector('#style-manager-host')!,proxyFixture?.port??{get:async()=>structuredClone(proxy),replace:async(s:any)=>{proxy={...structuredClone(s),revision:proxy.revision+1};return structuredClone(proxy)}},()=>{manager=undefined},'https://example.test/0')};
 if(conditions.workspaceDemo)fixture.enableWorkspaces(conditions.singleDefault===true,conditions.pinCount===9?9:3);
 const controller=createController(port);
 const mounted=mount(document.querySelector('#app')!,shellView(controller,undefined,undefined,undefined,undefined,undefined,show,undefined),controller.source);
 await controller.ready;
 const stopInteractions=observeSplitInteractions(document,controller);
 const stopResize=observeSidebarResize(document,controller.previewSidebarWidth,controller.setSidebarWidth);
 const stopDismissal=observeShellDismissal({deactivate:()=>controller.blurAddress()});
 const focusKey=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='l'){event.preventDefault();focusAddress(document,controller);}};
 document.addEventListener('keydown',focusKey);
 const layoutDemo = conditions.layoutDemo ? await (await import('./layout-demo')).mountLayoutDemo(controller, conditions, fixture) : undefined;
 if(conditions.workspaceEdit)controller.openWorkspaceEditor(controller.state().browser.workspaces?.active);
 if(conditions.workspaceCreate)controller.openWorkspaceEditor();
 const splitDemo = conditions.splitDemo ? (await import('./split-demo')).mountSplitDemo(controller,conditions,fixture) : undefined;
 if(conditions.proxyDemo)show();
 if(conditions.manager)show();
 return()=>{stopInteractions();stopResize();stopDismissal();document.removeEventListener('keydown',focusKey);layoutDemo?.();tools?.dispose();splitDemo?.();manager?.dispose();mounted.dispose();void controller.close();fixture.dispose()};
});
