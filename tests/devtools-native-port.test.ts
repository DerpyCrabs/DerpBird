import {expect,test} from 'bun:test';
import {connectDevTools,decodeDOM,type DevToolsTransport} from '../src/devtools/native-port';
const row={id:'1',url:'https://example.test/data',method:'GET',status:0,type:'Fetch/XHR',bytes:0,start:1,duration:0,initiator:'fetch',headers:{},requestHeaders:{},complete:false};
function transport(initial:unknown){let listener:(v:unknown)=>void=()=>{};return {onDevTools(fn:(v:unknown)=>void){listener=fn;return()=>{listener=()=>{};};},async devtoolsRequest(p:Record<string,unknown>){if(p.type==='devtools.bootstrap')return initial;if(p.type==='devtools.clear')return null;return 'body';},emit(value:unknown){listener(value);}} satisfies DevToolsTransport & {emit(value:unknown):void};}
test('normal shell handshake releases its listener',async()=>{const t=transport(null);expect(await connectDevTools(t)).toBeNull();t.emit({requests:'invalid'});});
test('native request updates retain identity, completed body and console deltas',async()=>{const t=transport({requests:[row],sources:[],dom:{},messages:[]});const p=(await connectDevTools(t))!;let updates=0;p.subscribe!(()=>updates++);t.emit({requests:[{...row,status:200,complete:true,bytes:100}]});expect(p.requests).toHaveLength(1);expect(p.requests[0]?.status).toBe(200);expect(await p.response('1')).toBe('body');t.emit({messages:[{level:'warning',text:'warning'}]});expect(p.messages).toHaveLength(1);await p.clearRequests!();t.emit({requests:[{...row,id:'2'}]});expect(p.requests.map(r=>r.id)).toEqual(['2']);expect(updates).toBe(3);p.dispose();t.emit({messages:[{level:'info',text:'late'}]});expect(updates).toBe(3);});
test('clicked DOM node and computed properties survive delayed DOM delivery',async()=>{const t=transport({requests:[],sources:[],dom:{},messages:[],nodeId:'4',styles:{color:'rgb(1, 2, 3)'}});const p=(await connectDevTools(t))!;let selected='';p.subscribe!(u=>{selected=u.selectedNodeId??selected;});t.emit({dom:{id:1,type:'document',name:'#document',children:[{id:4,type:'element',name:'div',attributes:{id:'probe'},children:[]}]}});expect(selected).toBe('4');expect(p.elements[1]?.styles.color).toBe('rgb(1, 2, 3)');expect(p.elements[1]?.text).toBe('<div id="probe">');p.dispose();});
test('invalid update becomes a visible error and does not corrupt requests',async()=>{const t=transport({requests:[row],sources:[],dom:{},messages:[]});const p=(await connectDevTools(t))!;let error='';p.subscribe!(u=>{error=u.error??'';});t.emit({requests:[{...row,status:'bad'}]});expect(error).toContain('Invalid request status');expect(p.requests[0]?.status).toBe(0);p.dispose();});
test('DOM text is represented as text, never executed markup',()=>{expect(decodeDOM({id:5,type:'text',name:'#text',text:'<script>alert(1)</script>'})[0]?.text).toBe('<script>alert(1)</script>');});
test('native window controls preserve confirmed dock and picker state',async()=>{
 const calls:Record<string,unknown>[]=[];
 const t=transport({requests:[],sources:[],dom:{},messages:[],dock:'right',picking:false});
 const request=t.devtoolsRequest.bind(t);
 t.devtoolsRequest=async payload=>{calls.push(payload);return payload.type==='devtools.bootstrap'?request(payload):null;};
 const p=(await connectDevTools(t))!;
 await p.setDock!('bottom');await p.pickElement!();
 expect(p.dock).toBe('right');
 t.emit({dock:'bottom',picking:true});expect(p.dock).toBe('bottom');expect(p.picking).toBe(true);
 t.emit({picking:false,nodeId:'42'});expect(p.picking).toBe(false);expect(p.selectedNodeId).toBe('42');
 await p.dismiss!();expect(calls.slice(1)).toEqual([{type:'devtools.dock',position:'bottom'},{type:'devtools.pick'},{type:'devtools.dismiss'}]);p.dispose();
});
test('captured images stay binary and malformed image packets are rejected',async()=>{
 const t=transport({requests:[],sources:[],dom:{},messages:[]});
 const bootstrap=t.devtoolsRequest.bind(t);
 let image:unknown={encoding:'base64',mimeType:'image/png',data:'iVBORw==',bytes:4};
 t.devtoolsRequest=async p=>p.type==='devtools.bootstrap'?bootstrap(p):image as any;
 const p=(await connectDevTools(t))!;
 expect(await p.response('image')).toEqual({encoding:'base64',mimeType:'image/png',data:'iVBORw==',bytes:4});
 image={encoding:'base64',mimeType:'text/html',data:'AAAA',bytes:3};
 await expect(p.response('image')).rejects.toThrow('Invalid image response');
 image={encoding:'base64',mimeType:'image/png',data:'!!!',bytes:3};
 await expect(p.response('image')).rejects.toThrow('Invalid image response');
 p.dispose();
});
test('background DOM updates do not request a panel switch',async()=>{
 const t=transport({requests:[],sources:[],dom:{},messages:[],nodeId:'2'});const p=(await connectDevTools(t))!;
 const reveals:(boolean|undefined)[]=[];p.subscribe!(u=>reveals.push(u.revealElement));
 t.emit({dom:{id:2,type:'element',name:'div'}});t.emit({styles:{color:'red'},nodeId:'2'});t.emit({nodeId:'2',revealElement:true});
 expect(reveals).toEqual([undefined,undefined,true]);p.dispose();
});

test('DOM mutation subtrees replace children and preserve selected styles',async()=>{
 const t=transport({requests:[],sources:[],messages:[],nodeId:'2',styles:{color:'red'},dom:{id:1,type:'document',name:'#document',children:[{id:2,type:'element',name:'span',children:[{id:3,type:'text',text:'old'}]}]}});
 const p=(await connectDevTools(t))!;
 t.emit({domMutations:[{id:2,type:'element',name:'span',attributes:{class:'new'},children:[{id:4,type:'text',text:'changed'}]}]});
 expect(p.elements.map(e=>e.id)).toEqual(['1','2','4']);
 expect(p.elements[1]?.styles.color).toBe('red');expect(p.elements[2]?.text).toBe('changed');
 t.emit({domMutations:[{id:3,type:'text',text:'stale removed node'}]});
 expect(p.elements.map(e=>e.id)).toEqual(['1','2','4']);
 t.emit({dom:{id:10,type:'document',name:'#document',children:[]},domMutations:[{id:2,type:'element',name:'stale'}]});
 expect(p.elements.map(e=>e.id)).toEqual(['10']);p.dispose();
});

test('whitespace mutation targets remain indexed when not rendered',async()=>{
 const t=transport({dom:{id:1,type:'element',name:'p',children:[{id:2,type:'text',text:'  '}]}});
 const p=(await connectDevTools(t))!;expect(p.elements.length).toBe(1);
 t.emit({domMutations:[{id:2,type:'text',text:'now visible'}]});
 expect(p.elements[1]?.text).toBe('now visible');p.dispose();
});
