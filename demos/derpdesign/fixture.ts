import { favicon } from './favicons';
import { layoutFromSettings, layoutToSettings, type ChromeLayout } from '../../src/browser/chrome-layout';
import type {NativePort,Command,Tab,BrowserSnapshot,SplitView} from '../../src/browser/protocol';
type MutableTab={-readonly [K in keyof Tab]:Tab[K]};
type CanDrop=(tabs:readonly Tab[],source:string,target:string,placement:'before'|'inside'|'after')=>boolean;
/** Stateful native boundary. UI/controllers still come from the target checkout. */
export function createBirdFixture(layout:'horizontal'|'vertical',canDrop:CanDrop){
 let serial=0,revision=1,activeTabId:string|null='research';
 let preferences={layout,sidebarWidth:240,wrapTabs:false,theme:'dark' as 'dark'|'light',alwaysClose:true,chromeLayout:layoutFromSettings({verticalTabsEnabled:layout==='vertical'})};
 const makeTab=(id:string,title:string,url='about:blank',privateTab=false):MutableTab=>({id,title,url,private:privateTab,loading:false,canGoBack:false,canGoForward:false,pinned:false,audible:false,muted:false});
 let tabs:MutableTab[]=['Research notes','Accessibility checklist','Release planning'].map((title,i)=>makeTab(['research','accessibility','release'][i],title,`https://example.test/${i}`));
 let addressSuggestions: BrowserSnapshot['addressSuggestions'];
 let splits:SplitView[]=[];
 const pair=(id:string)=>splits.find(s=>s.firstTabId===id||s.secondTabId===id);
 const dissolve=(id:string)=>{splits=splits.filter(s=>s!==pair(id));};
 const closed:MutableTab[][]=[];const listeners=new Set<(s:unknown)=>void>();
 const snapshot=():BrowserSnapshot=>structuredClone({version:1,revision,preferences,activeTabId,tabs,splits,addressSuggestions,workspaces:workspaces() as BrowserSnapshot['workspaces']});
 const get=(id:string)=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('Unknown fixture tab '+id);return tab;};
 const block=(id:string)=>tabs.filter(t=>t.id===id||t.parentId===id);
 const end=(id:string)=>{let i=tabs.findIndex(t=>t.id===id);while(tabs[i+1]?.parentId===id)i++;return i+1;};
 function remove(ids:Set<string>){
  const activeSplit=activeTabId?pair(activeTabId):undefined;
  if(activeSplit&&activeTabId&&ids.has(activeTabId)){
   const survivor=activeSplit.firstTabId===activeTabId?activeSplit.secondTabId:activeSplit.firstTabId;
   if(!ids.has(survivor))activeTabId=survivor;
  }
  splits=splits.filter(s=>!ids.has(s.firstTabId)&&!ids.has(s.secondTabId));
  const index=tabs.findIndex(t=>t.id===activeTabId);closed.push(structuredClone(tabs.filter(t=>ids.has(t.id))));tabs=tabs.filter(t=>!ids.has(t.id));
  tabs.forEach(t=>{if(t.parentId&&ids.has(t.parentId))delete t.parentId;});
  if(!tabs.some(t=>t.id===activeTabId))activeTabId=tabs[Math.min(index,tabs.length-1)]?.id??null;
 }
 function move(id:string,targetId:string,placement:'before'|'inside'|'after'){
  const source=get(id),target=get(targetId);
  if(source.private!==target.private||!canDrop(tabs,id,targetId,placement))throw Error('Invalid fixture tab move');
  dissolve(id);
  const moving=block(id);tabs=tabs.filter(t=>!moving.includes(t));
  const parent=placement==='inside'?(pair(target.id)?.firstTabId??target.parentId??target.id):target.parentId;
  if(parent)source.parentId=parent;else delete source.parentId;
  const index=placement==='before'?tabs.indexOf(target):placement==='inside'?end(parent!):end(target.id);
  tabs.splice(index,0,...moving);
 }
 const port:NativePort={version:1,snapshot:async()=>snapshot(),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},async request(command:Command){
  const c=command;
  // Geometry is consumed by the native compositor, which this fixture does not simulate.
  if(c.type==='shell.viewport')return;
  switch(c.type){
   case 'workspace.switch':switchWorkspace(c.id);return;
   case 'workspace.create':createWorkspace(c.name,c.icon,c.color);return;
   case 'workspace.update':{const w=spaces.find(w=>w.id===c.id);if(!w)throw Error('Unknown workspace');Object.assign(w,{name:c.name,icon:c.icon,color:c.color});publish();return;}

   case 'tab.split':{
    const source=get(c.tabId),target=get(c.targetId);
    if(source===target||source.pinned||target.pinned||source.private!==target.private)throw Error('Invalid fixture split');
    dissolve(source.id);dissolve(target.id);
    const before=c.edge==='left'||c.edge==='top',first=before?source:target,second=before?target:source;
    // Match native detach_tree_tab: pairing first promotes existing children.
    tabs.forEach(t=>{if(t.parentId===source.id||t.parentId===target.id)delete t.parentId;});
    delete first.parentId;delete second.parentId;
    splits.push({id:`split-${++serial}`,firstTabId:first.id,secondTabId:second.id,axis:c.edge==='left'||c.edge==='right'?'horizontal':'vertical',ratio:.5});
    activeTabId=source.id;break;
   }
   case 'split.switch':{const s=pair(c.tabId);if(!s)throw Error('No split');splits=splits.map(x=>x===s?{...x,axis:x.axis==='horizontal'?'vertical':'horizontal'}:x);break;}
   case 'split.resize':{const s=pair(c.tabId);if(!s)throw Error('No split');splits=splits.map(x=>x===s?{...x,ratio:Math.max(.2,Math.min(.8,c.ratio))}:x);break;}

   case 'browser.open-page': {
    if(c.page!=='settings')throw Error('Unsupported fixture page '+c.page);
    let tab=tabs.find(t=>t.url==='about:settings');
    if(!tab){tab=makeTab(`settings-${++serial}`,'Settings','about:settings');tabs.push(tab);}
    activeTabId=tab.id;break;
   }
   case 'browser.suggest': {
    const q=c.input.trim().toLowerCase();
    addressSuggestions={query:c.query,items:[
      {text:c.input,title:`Search for “${c.input}”`,source:'search',subtitle:'Search the web'},
      ...[{text:'https://developer.mozilla.org/en-US/docs/Web/Accessibility',title:'Accessibility — MDN',source:'bookmark' as const},
          {text:'https://web.dev/learn/accessibility/',title:'Learn accessibility',source:'history' as const},
          {text:'https://example.test/research',title:'Research library',source:'history' as const}].filter(item=>`${item.title} ${item.text}`.toLowerCase().includes(q))
    ]};break;
   }
   case 'shell.set-chrome-layout':preferences.chromeLayout=layoutFromSettings(layoutToSettings(c.layout));preferences.layout=['sidebar','compact'].includes(c.layout.preset)?'vertical':'horizontal';break;
   case 'shell.set-layout':preferences.layout=c.layout;preferences.chromeLayout={...preferences.chromeLayout,preset:c.layout==='vertical'?'sidebar':'classic',address:'top'};break;
   case 'shell.set-sidebar-width':preferences.sidebarWidth=c.width;break;
   case 'shell.set-appearance':preferences.theme=c.theme;preferences.alwaysClose=c.alwaysClose;break;
   case 'shell.set-wrap-tabs':preferences.wrapTabs=c.value;break;
   case 'tab.activate':get(c.tabId);activeTabId=c.tabId;break;
   case 'tab.create':{const t=makeTab(`new-${++serial}`,'New tab',c.url ?? 'about:newtab',c.private);tabs.push(t);activeTabId=t.id;break;}
   case 'tab.close':get(c.tabId);remove(new Set([c.tabId]));break;
   case 'tab.close-group':get(c.tabId);remove(new Set(block(c.tabId).map(t=>t.id)));break;
   case 'tab.close-others':get(c.tabId);remove(new Set(tabs.filter(t=>t.id!==c.tabId&&!t.pinned).map(t=>t.id)));break;
   case 'tab.close-right':{const i=tabs.indexOf(get(c.tabId));remove(new Set(tabs.slice(i+1).filter(t=>!t.pinned).map(t=>t.id)));break;}
   case 'tab.reopen':{const restored=closed.pop();if(restored?.length){restored.forEach(t=>{if(t.parentId&&!tabs.some(p=>p.id===t.parentId)&&!restored.some(p=>p.id===t.parentId))delete t.parentId;});const parent=restored[0].parentId;tabs.splice(parent?end(parent):tabs.length,0,...restored);activeTabId=restored[0].id;}break;}
   case 'tab.duplicate':{const t={...get(c.tabId),id:`new-${++serial}`};tabs.splice(end(c.tabId),0,t);activeTabId=t.id;break;}
   case 'tab.tree-move':move(c.tabId,c.targetId,c.placement);break;
   case 'tab.new-child':{const parent=get(pair(c.tabId)?.firstTabId??c.tabId);if(parent.pinned)throw Error('Pinned tabs cannot have children');const t=makeTab(`new-${++serial}`,'New tab','about:blank',parent.private);t.parentId=parent.parentId??parent.id;tabs.splice(end(t.parentId),0,t);activeTabId=t.id;break;}
   case 'tab.ungroup':{const t=get(c.tabId);if(t.parentId){const parent=t.parentId;tabs.splice(tabs.indexOf(t),1);tabs.splice(end(parent),0,t);delete t.parentId;}else tabs.forEach(child=>{if(child.parentId===t.id)delete child.parentId;});break;}
   case 'tab.move':{const t=get(c.tabId),target=tabs[c.index];if(target&&target!==t)move(t.id,target.id,c.index<tabs.indexOf(t)?'before':'after');break;}
   case 'tab.pin':{dissolve(c.tabId);const t=get(c.tabId);delete t.parentId;tabs.forEach(child=>{if(child.parentId===t.id)delete child.parentId;});t.pinned=c.value;tabs=tabs.filter(x=>x!==t);tabs.splice(tabs.filter(x=>x.pinned).length,0,t);break;}
   case 'tab.mute':get(c.tabId).muted=c.value;break;
   case 'tab.navigate':case 'tab.navigate-input':{const t=get(c.tabId);t.url=c.url;t.title=c.url;t.canGoBack=true;break;}
   case 'tab.reload':case 'tab.stop':get(c.tabId).loading=false;break;
   case 'tab.zoom-in':case 'tab.zoom-out':case 'tab.zoom-reset':{const t=get(c.tabId);t.zoom=c.type==='tab.zoom-reset'?1:Math.max(.25,Math.min(5,(t.zoom??1)+(c.type==='tab.zoom-in'?.1:-.1)));break;}
   default:throw Error(`DerpBird fixture does not implement ${c.type}`);
  }
  revision++;const next=snapshot();listeners.forEach(listener=>listener(structuredClone(next)));
 }};
 type Workspace = {id:string;name:string;icon:string;color:string;tabs:MutableTab[];activeTabId:string|null;splits:SplitView[]};
 const spaces:Workspace[]=[{id:'default',name:'Default',icon:'research',color:'sage',tabs:[],activeTabId,splits:[]}];let workspaceId='default';
 const saveSpace=()=>{const w=spaces.find(w=>w.id===workspaceId);if(w)Object.assign(w,{tabs:structuredClone(tabs),activeTabId,splits:structuredClone(splits)});};
 const publish=()=>{revision++;const next=snapshot();listeners.forEach(listener=>listener(structuredClone(next)));};
 function switchWorkspace(id:string){const w=spaces.find(w=>w.id===id);if(!w)throw Error('Unknown workspace');saveSpace();workspaceId=id;tabs=structuredClone(w.tabs);activeTabId=w.activeTabId;splits=structuredClone(w.splits);addressSuggestions=undefined;publish();}
 function enableWorkspaces(singleDefault=false,pinCount=3){spaces.length=0;workspaceId='research-space';
  const pin=makeTab('handbook','Figma','https://www.figma.com/');pin.pinned=true;pin.favicon=favicon('figma');
  const board=makeTab('board','GitHub','https://github.com/');board.pinned=true;board.favicon=favicon('github');
  const docs=makeTab('docs','MDN Web Docs','https://developer.mozilla.org/');docs.pinned=true;docs.favicon=favicon('mdn');
  const extra=[['notion','Notion','https://www.notion.so/'],['linear','Linear','https://linear.app/'],['globe','Web platform','https://web.dev/'],['github','DerpBird repository','https://github.com/example/derpbird'],['figma','Component library','https://www.figma.com/library'],['mdn','CSS reference','https://developer.mozilla.org/en-US/docs/Web/CSS'],['globe','Web standards','https://www.w3.org/']].slice(0,Math.max(0,pinCount-3)).map(([mark,title,url],i)=>{const t=makeTab(`pin-${i+4}`,title,url);t.pinned=true;t.favicon=favicon(mark);return t;});
  tabs.unshift(...[pin,board,docs,...extra].slice(0,pinCount));
  spaces.push({id:workspaceId,name:singleDefault?'Default':'Research',icon:'research',color:'sage',tabs:[],activeTabId,splits:[]});saveSpace();
  if(!singleDefault){
   const home=makeTab('reading','Reading list','https://example.test/reading');home.pinned=true;home.favicon=favicon('notion');
   const weekend=makeTab('weekend','Weekend ideas','https://example.test/weekend');weekend.favicon=favicon('globe');
   spaces.push({id:'personal-space',name:'Personal',icon:'home',color:'peach',tabs:[home,weekend],activeTabId:'weekend',splits:[]},
    {id:'build-space',name:'Build',icon:'code',color:'lilac',tabs:[makeTab('build','Release checklist','https://example.test/build')],activeTabId:'build',splits:[]});
  }
  publish();
 }
 function createWorkspace(name:string,icon='research',color='sage'){const id=`workspace-${++serial}`;const tab=makeTab(`new-${++serial}`,'New tab','about:newtab');spaces.push({id,name,icon,color,tabs:[tab],activeTabId:tab.id,splits:[]});switchWorkspace(id);}
 function renameWorkspace(name:string,icon:string,color:string){const w=spaces.find(w=>w.id===workspaceId);if(!w)throw Error('Unknown workspace');Object.assign(w,{name,icon,color});publish();}
 const workspaces=()=>({active:workspaceId,items:spaces.map(w=>({id:w.id,name:w.name,icon:w.icon,color:w.color,count:w.id===workspaceId?tabs.length:w.tabs.length}))});
 function seedReadingTabs(titles:readonly string[]){
  titles.forEach((title,i)=>{const t=makeTab(`reading-${i+1}`,title,`https://example.test/reading-${i+1}`);tabs.push(t);});publish();
 }
 return {port,snapshot,seedReadingTabs,enableWorkspaces,switchWorkspace,createWorkspace,renameWorkspace,workspaces,dispose(){listeners.clear();}};
}
