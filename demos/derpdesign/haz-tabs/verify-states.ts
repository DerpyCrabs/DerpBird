import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const session=process.argv[2], out=process.argv[3]??'/tmp/haz-state-review';
const results:any[]=[];
function cli(args:string[]){return execFileSync('derpdesign',[...args,'--session',session],{encoding:'utf8',maxBuffer:20e6});}
function inspect(pane:string,selector:string){return JSON.parse(cli(['inspect','--pane',pane,'--selector',selector]));}
function event(pane:string,event:any){writeFileSync('/tmp/haz-native-event.json',JSON.stringify({paneId:pane,event}));return cli(['call','pane_input','--file','/tmp/haz-native-event.json']);}
function point(pane:string,selector:string){const b=inspect(pane,selector).element.bounds;return{x:b.x+b.width/2,y:b.y+b.height/2};}
function hover(pane:string,selector:string){event(pane,{type:'pointer',action:'move',...point(pane,selector)});}
function capture(pane:string,label:string){cli(['screenshot','--pane',pane,'--out',`${out}/${label}.png`]);}
function check(ok:boolean,message:string,detail:any){results.push({message,passed:ok,detail});if(!ok)throw Error(message);}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 const pane='haz-vertical', list=inspect(pane,'.tab-list').element.bounds, row=inspect(pane,'.tab-unit:has([data-tab-id=research])').element.bounds;
 check(row.x+row.width<=list.x+list.width-6,'Sidebar rows keep a 6 px margin shared with the scrollbar',{list,row});
 const pin=inspect(pane,'.pinned-tab-unit:first-child').element.bounds;
 const pinHost=inspect(pane,'.pinned-tabs').element.bounds;
 check(Math.abs(pin.width-(pinHost.width-8)/3)<1&&pin.height===34,'Three pins fill their row at normal tab height',{pin,pinHost});
 for(const [p,selector,label] of [['haz-vertical','[data-tab-id=accessibility]','vertical-hover'],['haz-horizontal','[data-tab-id=accessibility]','horizontal-hover'],['haz-reference','#haz-tab-1','reference-hover']]){
  event(p,{type:'pointer',action:'move',x:3,y:3});await wait(180);
  const before=inspect(p,selector).element.bounds;hover(p,selector);await wait(180);const after=inspect(p,selector).element.bounds;
  check(JSON.stringify(before)===JSON.stringify(after),`${label}: hit target stays fixed`,{before,after});capture(p,label);
 }
 const edgePane='haz-horizontal', edgeSelector='[data-tab-id=reading-1]';
 const initial=inspect(edgePane,edgeSelector).element.bounds;
 for(const action of ['move','down','up'])event(edgePane,{type:'pointer',action,button:'left',x:initial.x+16,y:initial.y+15});
 const positions=[];for(let i=0;i<5;i++)positions.push(inspect(edgePane,edgeSelector).element.bounds.x);
 const final=positions.at(-1)!;
 check(positions.some(x=>x>Math.min(initial.x,final)&&x<Math.max(initial.x,final)),'Clicking an edge tab animates its reveal',{start:initial.x,positions});
 check(inspect(edgePane,edgeSelector+'[aria-selected=true]').element.matchCount===1,'Click remains on its original target',true);
 await wait(320);
 const close=inspect(edgePane,'button[aria-label="Close Tabs UI · Diego Haz"]').element.bounds,chevron=inspect(edgePane,'.haz-scroll.next').element.bounds;
 check(close.x+close.width<=chevron.x,'Revealed tab close action clears the chevron',{close,chevron});capture(edgePane,'edge-tab-revealed');
 hover('haz-vertical','.pinned-tab-unit:first-child [role=tab]');await wait(180);capture('haz-vertical','pin-hover');
 const paneRef='haz-reference', next=point(paneRef,'.haz-scroll.next');
 for(const action of ['move','down','up'])event(paneRef,{type:'pointer',action,button:'left',...next});
 const appearing=[];
 for(let i=0;i<4;i++){const c=inspect(paneRef,'.haz-scroll.previous').computedStyles;appearing.push({opacity:Number(c.opacity),visibility:c.visibility});}
 await wait(320);
 for(let n=0;n<4;n++){for(const action of ['move','down','up'])event(paneRef,{type:'pointer',action,button:'left',...next});await wait(320);}
 const endpoint=inspect(paneRef,'.haz-scroll.next[aria-disabled=true]').computedStyles;
 check(endpoint.visibility==='visible'&&Math.abs(Number(endpoint.opacity)-.35)<.02,'Endpoint stays dimmed beneath pointer',{opacity:endpoint.opacity,visibility:endpoint.visibility});capture(paneRef,'endpoint-hover');
 event(paneRef,{type:'pointer',action:'move',x:3,y:3});
 const disappearing=[];
 for(let i=0;i<4;i++){const c=inspect(paneRef,'.haz-scroll.next').computedStyles;disappearing.push({opacity:Number(c.opacity),visibility:c.visibility});}
 await wait(220);const hidden=inspect(paneRef,'.haz-scroll.next').computedStyles;
 check(appearing.some(x=>x.opacity>0&&x.opacity<1),'Chevron appearance has intermediate opacity',appearing);
 check(disappearing.some(x=>x.opacity>0&&x.opacity<.35&&x.visibility==='visible'),'Chevron stays painted throughout its fade-out',disappearing);
 check(hidden.visibility==='hidden'&&Number(hidden.opacity)===0,'Chevron hides after fading',hidden.visibility);capture(paneRef,'endpoint-left');
}finally{writeFileSync(`${out}/state-checks.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
