import assert from 'node:assert/strict';
import {useTestProfile} from './agent-test-profile';
import {AgentSessions} from '../src/automation/sessions';
import {execFileSync} from 'node:child_process';
await useTestProfile();
const active=()=>process.env.HYPRLAND_INSTANCE_SIGNATURE?JSON.parse(execFileSync('hyprctl',['activewindow','-j'],{encoding:'utf8'})).address:undefined;
const focused=active();
let ownPid=0, stoleFocus=false;
const focusTimer=setInterval(()=>{if(process.env.HYPRLAND_INSTANCE_SIGNATURE&&ownPid){const w=JSON.parse(execFileSync('hyprctl',['activewindow','-j'],{encoding:'utf8'}));if(w.pid===ownPid)stoleFocus=true;}},250);
const fixture=Bun.serve({port:0,fetch:req=>new URL(req.url).pathname.startsWith('/api/')?Response.json({ok:true}):new Response(`<!doctype html><title>Automation feedback</title><style>body{margin:55px;background:#fafafa;color:#202124;font:18px system-ui}button,input{font:inherit;padding:12px;margin:12px}#drag,#drop{display:inline-block;margin:25px;padding:35px;background:#eee}#drop{margin-left:100px}#long{height:1200px}</style><h1>Automation feedback</h1><button id="open" onclick="window.trusted=event.isTrusted;setTimeout(()=>document.querySelector('output').textContent='Form opened',35)">Open form</button><input aria-label="Note" placeholder="Note"><output>Ready</output><div><div id="drag">Drag</div><div id="drop">Drop</div></div><div id="long"></div>` ,{headers:{'Content-Type':'text/html'}})});
const s=new AgentSessions();
async function save(name:string){const r=await s.browser.windowScreenshot();await Bun.write(`artifacts/feedback-${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await s.launch();ownPid=Number(s.list().find(x=>x.selected)!.socket.match(/automation-(\d+)/)?.[1]);const b=s.browser;await b.navigate(fixture.url.href);
 const end=Date.now()+15000;while(!(await b.evaluate('()=>innerWidth>300&&innerHeight>200'))){assert(Date.now()<end);await Bun.sleep(50)}
 const first=await b.snapshot();const ref=first.split('\n').find(l=>l.includes('button "Open form"'))!.match(/ref=(e\d+)/)![1]!;
 const second=await b.snapshot();assert(second.includes(`button "Open form" [ref=${ref}]`),'Repeated snapshots preserve element identity');
 await b.snapshot(await b.resolveTarget('input'));
 const clicked=await b.click(ref);assert(clicked.includes('Form opened'),'Post-click snapshot observes deferred DOM update');
 await save('click');
 assert.equal(await b.evaluate('()=>window.trusted'),true);
 await b.type(await b.resolveTarget('input'),'Verified');await save('type');
 // Same button handle remains valid after unrelated typing and its resulting snapshot.
 assert.equal(await b.resolveTarget('#open'),ref);await b.click(ref);
 await b.drag(await b.resolveTarget('#drag'),await b.resolveTarget('#drop'));await save('drag');
 const evaluating=b.evaluate('()=>new Promise(resolve=>setTimeout(()=>resolve(42),1800))');
 await Bun.sleep(450);if(process.env.SWAYSOCK)execFileSync('grim',['-o','HEADLESS-1','artifacts/feedback-compositor.png']);await save('evaluate');assert.equal(await evaluating,42);
 // Source text and typed values must never appear in the browser overlay.
 assert.equal(await b.evaluate('()=>document.querySelectorAll("[class*=activity-overlay],.ad-overlay").length'),0);
 await b.evaluate('()=>Promise.all(Array.from({length:8},(_,i)=>fetch("/api/"+i)))');
 const page=b.networkRequests({url:'/api/',limit:2});assert.equal(page.events.length,2);assert(page.total>=8);assert.equal(page.nextOffset,2);
 assert(page.events.every(e=>!('headers' in e)&&!('request' in e)));
 const next=b.networkRequests({url:'/api/',offset:2,limit:2});assert.equal(next.events.length,2);
 const responses=b.networkRequests({url:'/api/',status:200});assert(responses.events.every(e=>e.status===200));
 await b.scroll(320);assert((await b.evaluate('()=>scrollY'))>0);await save('scroll');
 await b.evaluate('()=>document.querySelector("#open").remove()');
 await assert.rejects(()=>b.click(ref),/detached|no such|not found|stale/i);
 await b.navigate(fixture.url.href);await assert.rejects(()=>b.resolveTarget(ref),/Stale/);
 await Bun.sleep(1500);await save('idle');assert.equal(stoleFocus,false,'Agent window must never take focus');
 await Bun.write('artifacts/feedback-report.json',JSON.stringify({stableReferences:true,scopedSnapshotPreservesReferences:true,postActionDOMUpdate:true,trustedInput:true,networkPagination:page,noAgentFocusObserved:true,userFocusChanged:active()!==focused,overlayOutsideDOM:true},null,2));
 console.log('PASS: stable references, deferred DOM, filtered network pagination, native feedback, no agent focus observed');
}finally{clearInterval(focusTimer);await s.closeAll();fixture.stop()}
