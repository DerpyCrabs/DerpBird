import type { ConsoleRecord, DevToolsPort, DOMRecord, RequestRecord, SourceRecord, DevToolsUpdate } from './model';

export interface DevToolsTransport {
  devtoolsRequest(payload: Record<string, unknown>): Promise<unknown>;
  onDevTools(listener: (value: unknown) => void): () => void;
}
const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid developer tools packet');
  return value as Record<string, any>;
};
const list = (value: unknown): any[] => { if (!Array.isArray(value)) throw Error('Invalid developer tools list'); return value; };
const text = (value: unknown): string => { if (typeof value !== 'string') throw Error('Invalid developer tools text'); return value; };
export function decodeDOM(value: unknown): DOMRecord[] {
  const root = record(value), rows: DOMRecord[] = [];
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const {node,depth} = stack.pop()!;
    if (node.id !== undefined) {
      const name = String(node.name ?? '');
      const attributes = Object.entries(node.attributes ?? {}).map(([key,value]) => ` ${key}="${String(value)}"`).join('');
      const label = node.type === 'text' ? String(node.text ?? '') : node.type === 'comment' ? `<!--${node.data ?? ''}-->` : node.type === 'element' ? `<${name}${attributes}>` : name;
      if (label.trim()) rows.push({id:String(node.id),depth,text:label,styles:{}});
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i=children.length-1;i>=0;i--) stack.push({node:record(children[i]),depth:depth+1});
  }
  return rows;
}
export async function connectDevTools(transport: DevToolsTransport): Promise<(DevToolsPort & {dispose():void}) | null> {
  const listeners = new Set<(update: DevToolsUpdate)=>void>();
  const requests = new Map<string,RequestRecord>();
  let port: (DevToolsPort & {dispose():void}) | undefined;
  let buffered: unknown[] = [];
  let stopped = false;
  let selectedId = '';
  let selectedStyles: Record<string,string> = {};
  const apply = (raw: unknown, initial=false) => {
    const packet=record(raw), update: DevToolsUpdate={};
    if(packet.revealElement===true)update.revealElement=true;
    if(packet.dock!==undefined){if(!["left","right","bottom","window"].includes(packet.dock))throw Error("Invalid dock position");update.dock=packet.dock;}
    if(packet.picking!==undefined){if(typeof packet.picking!=="boolean")throw Error("Invalid picker state");update.picking=packet.picking;}
    if(packet.requests!==undefined){
      for(const raw of list(packet.requests)){
        const r=record(raw);
        for(const key of ['id','url','method','type','initiator'])text(r[key]);
        for(const key of ['status','bytes','start','duration'])if(typeof r[key]!=='number'||!Number.isFinite(r[key]))throw Error(`Invalid request ${key}`);
        record(r.headers);record(r.requestHeaders);
        requests.set(r.id,r as RequestRecord);
      }
      update.requests=[...requests.values()].sort((a,b)=>a.start-b.start);
    }
    if(packet.dom!==undefined){update.elements=decodeDOM(packet.dom);if(selectedId)update.selectedNodeId=selectedId;}
    if(packet.sources!==undefined)update.sources=list(packet.sources).map(s=>({id:text(s.id),name:text(s.name),text:text(s.text)}));
    if(packet.messages!==undefined)update.messages=list(packet.messages).map(m=>({level:['info','warning','error','result'].includes(m.level)?m.level:'info',text:text(m.text)} as ConsoleRecord));
    if(packet.nodeId!==undefined){selectedId=text(packet.nodeId);update.selectedNodeId=selectedId;}
    if(packet.styles!==undefined){selectedStyles=Object.fromEntries(Object.entries(record(packet.styles)).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]));}
    const elements=update.elements??port?.elements;
    if(elements&&(packet.styles!==undefined||packet.dom!==undefined))update.elements=elements.map(e=>({...e,styles:e.id===selectedId?selectedStyles:{}}));
    if(port){
      if(update.dock)port.dock=update.dock;
      if(update.picking!==undefined)port.picking=update.picking;
      if(update.requests)port.requests=update.requests;
      if(update.elements)port.elements=update.elements;
      if(update.sources)port.sources=update.sources;
      if(update.messages)port.messages=initial?update.messages:[...port.messages,...update.messages].slice(-2000);
      if(update.selectedNodeId)port.selectedNodeId=update.selectedNodeId;
    }
    if(!initial)for(const listener of listeners)listener(update);
    return update;
  };
  const unsubscribe=transport.onDevTools(value=>{if(stopped)return;if(!port)buffered.push(value);else {try{apply(value);}catch(error){for(const listener of listeners)listener({error:String(error)});}}});
  try {
    const initial=await transport.devtoolsRequest({type:'devtools.bootstrap'});
    if(initial===null){unsubscribe();return null;}
    port={requests:[],elements:[],sources:[],messages:[],
      ...(record(initial).dock!==undefined?{setDock:async(position: import("./model").DockPosition)=>{await transport.devtoolsRequest({type:"devtools.dock",position});},pickElement:async()=>{await transport.devtoolsRequest({type:"devtools.pick"});},dismiss:async()=>{await transport.devtoolsRequest({type:"devtools.dismiss"});}}:{}),
      response:async id=>{
        const value=await transport.devtoolsRequest({type:'devtools.response',id});
        if(typeof value==='string')return value;
        const image=record(value);
        if(image.encoding!=='base64'||!/^image\/[a-z0-9.+-]+$/.test(text(image.mimeType))||typeof image.bytes!=='number'||image.bytes<0||image.bytes>8388608||(text(image.data).length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(image.data)))throw Error('Invalid image response');
        return {encoding:'base64' as const,mimeType:image.mimeType,data:image.data,bytes:image.bytes};
      },
      evaluate:async expression=>text(await transport.devtoolsRequest({type:'devtools.evaluate',expression})),
      source:async id=>text(await transport.devtoolsRequest({type:'devtools.source',id})),
      selectElement:async id=>{await transport.devtoolsRequest({type:'devtools.select',id});},
      clearRequests:async()=>{await transport.devtoolsRequest({type:'devtools.clear'});requests.clear();},
      refresh:async()=>{await transport.devtoolsRequest({type:'devtools.refresh'});},
      subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
      dispose(){stopped=true;unsubscribe();listeners.clear();requests.clear();buffered=[];}
    };
    apply(initial,true);
    for(const packet of buffered)apply(packet,true);
    buffered=[];
    return port;
  }catch(error){unsubscribe();throw error;}
}
