import { Effect } from 'effect';
import { modelOwner, mount, view } from 'effectweb';
import Search from '@effectweb/lucide/icons/search';
import Ban from '@effectweb/lucide/icons/ban';
import ArrowUp from '@effectweb/lucide/icons/arrow-up';
import ArrowDown from '@effectweb/lucide/icons/arrow-down';
import EllipsisVertical from '@effectweb/lucide/icons/ellipsis-vertical';
import PanelLeft from '@effectweb/lucide/icons/panel-left';
import PanelRight from '@effectweb/lucide/icons/panel-right';
import PanelBottom from '@effectweb/lucide/icons/panel-bottom';
import AppWindow from '@effectweb/lucide/icons/app-window';
import SquareMousePointer from '@effectweb/lucide/icons/square-mouse-pointer';
import X from '@effectweb/lucide/icons/x';
import ArrowLeftRight from '@effectweb/lucide/icons/arrow-left-right';
import FileCode from '@effectweb/lucide/icons/file-code';
import FileText from '@effectweb/lucide/icons/file-text';
import ImageIcon from '@effectweb/lucide/icons/image';
import TypeIcon from '@effectweb/lucide/icons/type';
import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import ChevronLeft from '@effectweb/lucide/icons/chevron-left';
import CircleAlert from '@effectweb/lucide/icons/circle-alert';
import TriangleAlert from '@effectweb/lucide/icons/triangle-alert';
import Info from '@effectweb/lucide/icons/info';
import CornerDownLeft from '@effectweb/lucide/icons/corner-down-left';
import { bytes, filterRequests, indexJSON, revealMatch, searchTree, visibleTree, windowRange, type ImageResponse, type DevToolsPort, type RequestRecord, type TreeRow, type ConsoleRecord, type DOMRecord, type SourceRecord } from './model';
import './devtools.css';
type Panel = 'Elements' | 'Console' | 'Sources' | 'Network';
interface Model {
 image?: ImageResponse; imageSize: string;
 dock?: import("./model").DockPosition; picking: boolean; dockMenu: boolean;
 elements: DOMRecord[]; sources: SourceRecord[]; sourceLoading: boolean; sourceError: string;
 panel: Panel; requests: RequestRecord[]; filtered: RequestRecord[]; filter: string; type: string;
 selected?: RequestRecord; detail: string; body: string; rawTree: TreeRow[]; bodyBytes: number; tree: TreeRow[]; visible: TreeRow[];
 expanded: Set<number>; query: string; sensitive: boolean; matches: number[]; match: number;
 elementScroll: number; requestScroll: number; previewScroll: number; height: number; loading: boolean; error: string;
 messages: ConsoleRecord[]; consoleFilter: string; expression: string; evaluating: boolean;
 source: number; sourceQuery: string; element: number; sort: string; descending: boolean;
}
export function mountDevTools(host: HTMLElement, port: DevToolsPort, initialPanel: Panel = 'Network') {
 let state: Model = { imageSize:'', dock:port.dock, picking:port.picking??false, dockMenu:false, elements: port.elements, sources: port.sources, sourceLoading:false, sourceError:'', panel: initialPanel, requests: port.requests, filtered: port.requests, filter: '', type: 'All', detail: 'Preview', body: '', rawTree: [], bodyBytes: 0, tree: [], visible: [], expanded: new Set([0,1,2,3]), query: '', sensitive: false, matches: [], match: 0, elementScroll: 0, requestScroll: 0, previewScroll: 0, height: host.clientHeight || 800, loading: false, error: '', messages: [...port.messages], consoleFilter: '', expression: '', evaluating: false, source: 0, sourceQuery: '', element: Math.max(0,port.elements.findIndex(e=>e.id===port.selectedNodeId)), sort: '', descending: false };
 const owner = modelOwner(state);
 let disposed = false, generation = 0, sourceGeneration = 0;
 let stopResize = () => {};
 let totalTime = port.requests.reduce((max,r)=>Math.max(max,r.start+r.duration),1);
 let transferred = port.requests.reduce((sum,r)=>sum+r.bytes,0);
 const cache = new Map<string, {body: string; tree: TreeRow[]; image?: ImageResponse}>();
 const patch = (change: Partial<Model>) => { if (!disposed) { state = { ...state, ...change }; owner.patch(change); } };
 const scroll = (selector: string, top: number) => requestAnimationFrame(() => { if (!disposed) { const el = host.querySelector(selector); if (el) el.scrollTop = top; } });
 const refilter = (change: Partial<Model>) => {
   const next = {...state, ...change};
   let filtered = filterRequests(next.requests, next.filter, next.type);
   if (next.sort) filtered = [...filtered].sort((a,b) => { const key = next.sort as 'status'|'duration'|'bytes'; return (a[key] - b[key]) * (next.descending ? -1 : 1); });
   totalTime = next.requests.reduce((max,r)=>Math.max(max,r.start+r.duration),1);
   transferred = filtered.reduce((sum,r)=>sum+r.bytes,0);
   patch({...change, filtered, requestScroll: 0}); scroll('.dt-requests',0);
 };
 const find = (query = state.query, sensitive = state.sensitive, index = 0) => {
   const rows = state.detail === 'Response' ? state.rawTree : state.tree;
   const matches = searchTree(rows, query, sensitive);
   const match = matches.length ? (index + matches.length) % matches.length : 0;
   const expanded = matches.length ? revealMatch(rows,state.expanded,matches[match]!) : state.expanded;
   const visible = visibleTree(rows,expanded);
   const top = matches.length ? Math.max(0,visible.findIndex(r=>r.id===matches[match]) * 26 - 104) : 0;
   patch({ query, sensitive, matches, match, expanded, visible, previewScroll: top }); scroll('.dt-preview',top);
 };
 const select = async (request: RequestRecord) => {
   const version = ++generation;
   patch({selected:request,loading:true,error:'',image:undefined,imageSize:'',body:'',tree:[],visible:[],matches:[],match:0,previewScroll:0,expanded:new Set([0,1,2,3])});
   if(request.complete===false){patch({loading:false});return;}
   try {
     let data = cache.get(request.id);
     if (!data) { const response = await port.response(request.id); const image=typeof response==='string'?undefined:response; const body=typeof response==='string'?response:''; let tree: TreeRow[]; try { tree = indexJSON(JSON.parse(body)); } catch { tree = body.split('\n').map((value,id)=>({id,parent:-1,depth:0,key:String(id+1),value,branch:false,end:id+1})); } data={body,tree,image}; if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(request.id,data); }
     if (disposed || version !== generation) return;
     patch({...data,rawTree:data.body.split('\n').map((value,id)=>({id,parent:-1,depth:0,key:String(id+1),value,branch:false,end:id+1})),bodyBytes:data.image?.bytes??new TextEncoder().encode(data.body).length,loading:false,visible:visibleTree(data.tree,state.expanded)}); find();
   } catch(error) { if(version===generation)patch({loading:false,error:String(error)}); }
 };
 const toggle = (id:number) => { const expanded=new Set(state.expanded); if(expanded.has(id))expanded.delete(id);else expanded.add(id);patch({expanded,visible:visibleTree(state.tree,expanded)}); };
 const evaluate = async () => {
   const expression=state.expression.trim();if(!expression||state.evaluating)return;
   patch({expression:'',evaluating:true,messages:[...state.messages,{level:'info',text:`› ${expression}`}]});
   try { const text=await port.evaluate(expression);patch({messages:[...state.messages,{level:'result',text}]}); }
   catch(error){patch({messages:[...state.messages,{level:'error',text:String(error)}]});}
   finally{patch({evaluating:false});}
 };
 const chooseElement = (index:number) => {
   patch({element:index});const node=state.elements[index];
   if(node&&port.selectElement)void port.selectElement(node.id).catch(error=>patch({error:String(error)}));
 };
 const chooseSource = async (index:number) => {
   const source=state.sources[index];patch({source:index,sourceError:''});
   if(!source?.id||!port.source)return;
   const version=++sourceGeneration;patch({sourceLoading:true});
   try {const text=await port.source(source.id);if(disposed||version!==sourceGeneration)return;patch({sources:state.sources.map(s=>s.id===source.id?{...s,text}:s)});}
   catch(error){if(version===sourceGeneration)patch({sourceError:String(error)});}
   finally{if(version===sourceGeneration)patch({sourceLoading:false});}
 };
 const clearRequests = async () => {
   try {await port.clearRequests?.();generation++;cache.clear();refilter({requests:[],selected:undefined});}
   catch(error){patch({error:String(error)});}
 };
 const highlight=(text:string,query:string,sensitive=false)=>{
   if(!query)return text;
   const hay=sensitive?text:text.toLowerCase(),needle=sensitive?query:query.toLowerCase();
   const pieces: any[]=[];let from=0,index=hay.indexOf(needle);
   while(index!==-1){pieces.push(text.slice(from,index),<mark>{text.slice(index,index+query.length)}</mark>);from=index+query.length;index=hay.indexOf(needle,from);}
   pieces.push(text.slice(from));return pieces;
 };
 const resourceIcon=(type:string)=>type==='Fetch/XHR'?<ArrowLeftRight size={14}/>:type==='JS'||type==='CSS'?<FileCode size={14}/>:type==='Img'?<ImageIcon size={14}/>:type==='Font'?<TypeIcon size={14}/>:<FileText size={14}/>;
 const tabs:Panel[]=['Elements','Console','Sources','Network'];
 const render=view<Model>(m=>{
   const range=windowRange(m.filtered.length,m.requestScroll,m.height);
   const elementRange=windowRange(m.elements.length,m.elementScroll,m.height,28);
   const previewRange=windowRange(m.visible.length,m.previewScroll,m.height);

   const headers=(label:string,entries:Record<string,string>)=><section class="dt-header-section"><h3>{label}</h3>{Object.entries(entries).map(([name,value])=><div><span>{name}</span><code>{value}</code></div>)}</section>;
   return <div class="dt" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();host.querySelector<HTMLInputElement>(m.panel==='Network'?'[aria-label="Search response"]':m.panel==='Sources'?'[aria-label="Find in source"]':'[aria-label="Filter console"]')?.focus();}}}>
     {m.error&&!m.selected?<div class="dt-notice" role="alert">{m.error}</div>:null}<nav class="dt-tabs" aria-label="Developer tools">{port.pickElement?<button aria-label="Pick element" title="Pick element" aria-pressed={m.picking} onClick={()=>void port.pickElement!().catch(error=>patch({error:String(error)}))}><SquareMousePointer size={15}/></button>:null}<div role="tablist">{tabs.map(panel=><button role="tab" aria-selected={m.panel===panel} onClick={()=>{patch({panel,height:host.clientHeight});void port.setPanel?.(panel).catch(error=>patch({error:String(error)}));if(panel==='Sources')void chooseSource(state.source);}}>{panel}</button>)}</div><div class="dt-window-actions">{port.setDock?<div class="dt-dock-control" onKeyDown={e=>{if(e.key==='Escape'){patch({dockMenu:false});host.querySelector<HTMLButtonElement>('[aria-label="Dock position"]')?.focus();}}}><button aria-label="Dock position" title="Dock position" aria-expanded={m.dockMenu} onClick={()=>patch({dockMenu:!m.dockMenu})}><EllipsisVertical size={15}/></button>{m.dockMenu?<div class="dt-dock-menu" role="group" aria-label="Dock side"><span>Dock side</span>{(['window','left','bottom','right'] as const).map(position=><button aria-label={position==='window'?'Undock into separate window':`Dock ${position}`} title={position==='window'?'Separate window':`Dock ${position}`} aria-pressed={m.dock===position} onClick={()=>{patch({dockMenu:false});void port.setDock!(position).catch(error=>patch({error:String(error)}));}}>{position==='window'?<AppWindow size={16}/>:position==='left'?<PanelLeft size={16}/>:position==='bottom'?<PanelBottom size={16}/>:<PanelRight size={16}/>}</button>)}</div>:null}</div>:null}{port.dismiss?<button aria-label="Close developer tools" title="Close developer tools" onClick={()=>void port.dismiss!().catch(error=>patch({error:String(error)}))}><X size={15}/></button>:null}</div></nav>
     {m.panel==='Network'?<div class="dt-network">
       <div class="dt-toolbar"><span class="dt-recording" title="Captured session"/><button aria-label="Clear requests" title="Clear requests" onClick={()=>void clearRequests()}><Ban size={15}/></button><span class="dt-separator"/><div class="dt-search"><Search size={14}/><input aria-label="Filter requests" placeholder="Filter URL · status:404 · method:POST" value={m.filter} onInput={e=>refilter({filter:e.currentTarget.value})}/>{m.filter?<button aria-label="Clear filter" onClick={()=>refilter({filter:''})}><X size={13}/></button>:null}</div><span class="dt-count">{m.filtered.length.toLocaleString()} requests</span></div>
       <div class="dt-types">{['All','Fetch/XHR','Doc','CSS','JS','Font','Img','Other'].map(type=><button aria-pressed={m.type===type} onClick={()=>refilter({type})}>{type}</button>)}</div>
       <div class={`dt-network-content ${m.selected?'has-detail':''}`}>
         <div class="dt-request-pane"><div class="dt-request-head dt-request-grid"><span>Name</span>{[['Status','status'],['Size','bytes'],['Time','duration']].map(([label,key])=><button onClick={()=>refilter({sort:key,descending:m.sort===key?!m.descending:false})}>{label}{m.sort===key?(m.descending?<ArrowDown size={12}/>:<ArrowUp size={12}/>):null}</button>)}<span>Waterfall</span></div>
         <div class="dt-requests" tabindex={0} aria-label="Network requests" onScroll={e=>patch({requestScroll:e.currentTarget.scrollTop})} onKeyDown={e=>{if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;e.preventDefault();const index=m.filtered.findIndex(r=>r.id===m.selected?.id);const next=Math.max(0,Math.min(m.filtered.length-1,index+(e.key==='ArrowDown'?1:-1)));if(m.filtered[next]){void select(m.filtered[next]!);scroll('.dt-requests',Math.max(0,next*26-104));}}}>
           <div style={{height:`${m.filtered.length*26}px`,position:'relative'}}>{m.filtered.slice(range.start,range.end).map((r,i)=><button class={`dt-request-grid dt-request ${r.id===m.selected?.id?'selected':''} ${r.status>=400||r.failed?'failed':''}`} style={{top:`${(range.start+i)*26}px`}} aria-label={`${r.method} ${r.url.split('/').pop()}`} aria-pressed={r.id===m.selected?.id} onClick={()=>void select(r)} title={r.url}><span class="dt-request-name"><span class="dt-kind" data-resource-type={r.type} aria-hidden="true">{resourceIcon(r.type)}</span>{r.url.split('/').pop()||'/'}<small>{r.method}</small></span><span>{r.failed?'Failed':r.status||'…'}</span><span>{bytes(r.bytes)}</span><span>{r.complete===false?'Pending':`${r.duration.toFixed(0)} ms`}</span><span class="dt-waterfall"><i style={{left:`${r.start/totalTime*100}%`,width:`${Math.max(.8,r.duration/totalTime*100)}%`}}/></span></button>)}</div>
           {!m.filtered.length?<div class="dt-empty">{m.requests.length?'No requests match this filter.':'No requests in this session.'}</div>:null}
         </div></div>
         {m.selected?<><div class="dt-divider" role="separator" aria-label="Resize request details" aria-orientation="vertical" tabindex={0} onMouseDown={e=>{e.preventDefault();stopResize();const bounds=host.querySelector('.dt-network-content')!.getBoundingClientRect();const detail=host.querySelector<HTMLElement>('.dt-detail')!;const move=(event:MouseEvent)=>{detail.style.width=`${Math.max(350,Math.min(bounds.width-345,bounds.right-event.clientX))}px`;};const stop=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',stop);};stopResize=stop;window.addEventListener('mousemove',move);window.addEventListener('mouseup',stop,{once:true});}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const detail=host.querySelector<HTMLElement>('.dt-detail')!;const width=host.clientWidth;detail.style.width=`${Math.max(350,Math.min(width-345,detail.clientWidth+(e.key==='ArrowLeft'?20:-20)))}px`;}}}/><aside class="dt-detail"><header class="dt-detail-title"><span class={m.selected.status>=400?'failed':'dt-success'}>{m.selected.status}</span><strong>{m.selected.url.split('/').pop()}</strong><button aria-label="Close request details" onClick={()=>{generation++;patch({selected:undefined});}}><X size={15}/></button></header><div class="dt-detail-tabs">{['Headers','Payload','Preview','Response','Timing'].map(detail=><button aria-pressed={m.detail===detail} onClick={()=>{patch({detail});find();}}>{detail}</button>)}</div>
           {['Preview','Response'].includes(m.detail)?<>{!m.image?<div class="dt-find"><Search size={14}/><input aria-label="Search response" placeholder="Find in response" value={m.query} onInput={e=>find(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();find(m.query,m.sensitive,m.match+(e.shiftKey?-1:1));}}}/><button aria-label="Match case" aria-pressed={m.sensitive} onClick={()=>find(m.query,!m.sensitive)}>Aa</button><span aria-live="polite">{m.matches.length?`${m.match+1} / ${m.matches.length}`:m.query?'No matches':'0 / 0'}</span><button aria-label="Previous match" disabled={!m.matches.length} onClick={()=>find(m.query,m.sensitive,m.match-1)}><ArrowUp size={14}/></button><button aria-label="Next match" disabled={!m.matches.length} onClick={()=>find(m.query,m.sensitive,m.match+1)}><ArrowDown size={14}/></button></div>:null}
           {m.selected.complete===false?<div class="dt-empty">Waiting for response…</div>:m.loading?<div class="dt-empty">Loading response…</div>:m.error?<div class="dt-empty failed" role="alert">{m.error}</div>:m.image?(m.detail==='Preview'?<div class="dt-image-preview"><img src={`data:${m.image.mimeType};base64,${m.image.data}`} alt={m.selected.url.split('/').pop()||'Response image'} onLoad={e=>patch({imageSize:`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`})} onError={()=>patch({error:'Unable to decode this image response.'})}/></div>:<div class="dt-empty">Binary image response. Open Preview to view the image.</div>):<div class="dt-preview" onScroll={e=>patch({previewScroll:e.currentTarget.scrollTop})}><div style={{height:`${m.visible.length*26}px`,position:'relative'}}>{m.visible.slice(previewRange.start,previewRange.end).map((row,i)=><div class={`dt-json-row ${m.matches[m.match]===row.id?'current-match':''}`} style={{top:`${(previewRange.start+i)*26}px`,paddingLeft:`${10+row.depth*16}px`}} data-node={row.id}><button class="dt-disclosure" aria-label={`${m.expanded.has(row.id)?'Collapse':'Expand'} ${row.key}`} aria-expanded={row.branch?m.expanded.has(row.id):undefined} disabled={!row.branch} onClick={()=>toggle(row.id)}>{row.branch?(m.expanded.has(row.id)?<ChevronDown size={13}/>:<ChevronRight size={13}/>):null}</button><span class="dt-json-key">{highlight(row.key,m.query,m.sensitive)}</span><span>{m.detail==='Response'?'  ':': '}</span><span class={row.branch?'dt-dim':row.value.startsWith('"')?'dt-string':'dt-value'}>{highlight(row.value,m.query,m.sensitive)}</span></div>)}</div></div>}
           <footer class="dt-preview-footer"><span>{m.image?`${m.image.mimeType}${m.imageSize?` · ${m.imageSize}`:''}`:m.detail==='Preview'?'Parsed response':'Response body'}</span><span>{bytes(m.bodyBytes)}</span></footer></>:m.detail==='Headers'?<div class="dt-scroll">{headers('General',{'Request URL':m.selected.url,'Request method':m.selected.method,'Status code':String(m.selected.status),'Initiator':m.selected.initiator})}{headers('Response headers',m.selected.headers)}{headers('Request headers',m.selected.requestHeaders)}</div>:m.detail==='Payload'?<div class="dt-scroll"><pre>{m.selected.payload||'This request has no payload.'}</pre></div>:<div class="dt-scroll">{headers('Request timing',{'Started at':`${m.selected.start} ms`,'Total duration':`${m.selected.duration} ms`})}<div class="dt-timing-bar"/><p>Duration includes the complete request and response.</p></div>}
         </aside></>:null}
       </div><footer class="dt-status"><span>{m.filtered.length.toLocaleString()} / {m.requests.length.toLocaleString()} requests</span><span>{bytes(transferred)} transferred</span><span>Finish: {(totalTime/1000).toFixed(2)} s</span></footer>
     </div>:m.panel==='Console'?<div class="dt-console"><div class="dt-toolbar"><button aria-label="Clear console" onClick={()=>patch({messages:[]})}><Ban size={15}/></button><div class="dt-search"><Search size={14}/><input aria-label="Filter console" placeholder="Filter console" value={m.consoleFilter} onInput={e=>patch({consoleFilter:e.currentTarget.value})}/></div><span class="dt-count">{m.messages.length} messages</span></div><div class="dt-console-log">{m.messages.filter(r=>r.text.toLowerCase().includes(m.consoleFilter.toLowerCase())).map(r=><div class={`dt-console-line ${r.level}`}><span class="dt-line-icon" aria-hidden="true">{r.level==='error'?<CircleAlert size={14}/>:r.level==='warning'?<TriangleAlert size={14}/>:r.level==='result'?<ChevronLeft size={14}/>:<Info size={14}/>}</span><code>{r.text}</code><small>{r.source}</small></div>)}</div><form class="dt-console-input" onSubmit={e=>{e.preventDefault();void evaluate();}}><ChevronRight size={16}/><input aria-label="Console expression" placeholder="Evaluate an expression" value={m.expression} disabled={m.evaluating} onInput={e=>patch({expression:e.currentTarget.value})}/><button disabled={m.evaluating||!m.expression.trim()} type="submit">Run <CornerDownLeft size={13}/></button></form></div>:m.panel==='Sources'?<div class="dt-sources"><aside><h3>Page</h3>{m.sources.map((source,i)=><button aria-pressed={m.source===i} title={source.name} onClick={()=>void chooseSource(i)}><span class="dt-kind dt-value" aria-hidden="true">{resourceIcon(source.name.endsWith('.js')||source.name.endsWith('.css')?'JS':'Doc')}</span><span class="dt-source-name">{source.name.split('/').pop()||source.name}</span></button>)}</aside><section><div class="dt-source-title">{m.sources[m.source]?.name}</div><div class="dt-find"><Search size={14}/><input aria-label="Find in source" placeholder="Find in file" value={m.sourceQuery} onInput={e=>patch({sourceQuery:e.currentTarget.value})}/></div><div class="dt-code">{m.sourceLoading?<div class="dt-empty">Loading source…</div>:null}{m.sourceError?<div class="dt-empty failed" role="alert">{m.sourceError}</div>:null}{!m.sources.length?<div class="dt-empty">No script sources available.</div>:null}{m.sources[m.source]?.text.split('\n').map((line,i)=><div><span>{i+1}</span><code>{highlight(line,m.sourceQuery)}</code></div>)}</div></section></div>:<div class="dt-elements"><section class="dt-dom-scroll" onScroll={e=>patch({elementScroll:e.currentTarget.scrollTop})}><div class="dt-source-title dt-dom-title">DOM tree</div>{!m.elements.length?<div class="dt-empty">Waiting for the document…</div>:null}{<div style={{height:`${m.elements.length*28}px`,position:'relative'}}>{m.elements.slice(elementRange.start,elementRange.end).map((element,offset)=>{const i=elementRange.start+offset;return <button class="dt-dom-row" data-node-id={element.id} style={{position:'absolute',top:`${i*28}px`,height:'28px',paddingLeft:`${12+element.depth*18}px`}} aria-pressed={m.element===i} onClick={()=>chooseElement(i)}><code>{element.text}</code>{m.element===i?<small> == $0</small>:null}</button>;})}</div>}</section><aside><div class="dt-source-title">Computed styles</div><div class="dt-rule"><span>{m.elements[m.element]?.text} {'{'}</span>{Object.entries(m.elements[m.element]?.styles??{}).map(([key,value])=><div><span>{key}</span>: <b>{value}</b>;</div>)}<span>{'}'}</span></div></aside></div>}
   </div>;
 });
 void port.setPanel?.(initialPanel).catch(error=>patch({error:String(error)}));
 const unsubscribe = port.subscribe?.(update=>{
   if(disposed)return;
   if(update.dock)patch({dock:update.dock});
   if(update.picking!==undefined)patch({picking:update.picking});
   if(update.error)patch({error:update.error});
   if(update.elements){const id=update.selectedNodeId??state.elements[state.element]?.id;patch({elements:update.elements,element:Math.max(0,update.elements.findIndex(e=>e.id===id))});}
   if(update.selectedNodeId){const index=state.elements.findIndex(e=>e.id===update.selectedNodeId);if(index>=0){patch({element:index,...(update.revealElement?{panel:'Elements' as const}:{})});if(update.revealElement){void port.setPanel?.('Elements');patch({elementScroll:index*28});requestAnimationFrame(()=>scroll('.dt-dom-scroll',index*28));}}}
   if(update.sources){const id=state.sources[state.source]?.id;patch({sources:update.sources,source:Math.max(0,update.sources.findIndex(s=>s.id===id))});if(state.panel==='Sources')void chooseSource(state.source);}
   if(update.messages)patch({messages:[...state.messages,...update.messages].slice(-2000)});
   if(update.requests){
     const previous=state.selected,selected=update.requests.find(r=>r.id===previous?.id);
     // Keep the scroll position while incoming events update only the visible window.
     const filtered=filterRequests(update.requests,state.filter,state.type);
     if(state.sort)filtered.sort((a,b)=>(a[state.sort as 'status'|'bytes'|'duration']-b[state.sort as 'status'|'bytes'|'duration'])*(state.descending?-1:1));
     totalTime=update.requests.reduce((max,r)=>Math.max(max,r.start+r.duration),1);transferred=filtered.reduce((sum,r)=>sum+r.bytes,0);
     patch({requests:update.requests,filtered,selected});
     if(selected&&previous?.complete===false&&selected.complete!==false){cache.delete(selected.id);void select(selected);}
   }
 });
 const dismissMenu=(e:PointerEvent)=>{if(state.dockMenu&&!(e.target as Element).closest('.dt-dock-control'))patch({dockMenu:false});};
 host.addEventListener('pointerdown',dismissMenu);
 const mounted=mount(host,render,owner.source);
 const resize=new ResizeObserver(()=>{if(state.panel==='Network'&&state.height!==host.clientHeight)patch({height:host.clientHeight});});resize.observe(host);
 if(initialPanel==='Network'&&port.requests[0])void select(port.requests[0]);
 return {dispose(){host.removeEventListener('pointerdown',dismissMenu);disposed=true;generation++;stopResize();unsubscribe?.();resize.disconnect();mounted.dispose();void Effect.runPromise(owner.close());}};
}
