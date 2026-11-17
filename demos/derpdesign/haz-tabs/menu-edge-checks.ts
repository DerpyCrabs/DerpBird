import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const [session,output]=process.argv.slice(2);
if(!session||!output)throw Error('Usage: bun menu-edge-checks.ts SESSION OUTPUT');
mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(tmpdir(),'menu-edge-checks-'));
const results:unknown[]=[];
const cli=(args:string[])=>execFileSync('derpdesign',[...args,'--session',session],{encoding:'utf8',maxBuffer:20e6});
try{
 for(const pane of ['haz-horizontal','haz-compact']){
  for(const [trigger,popup] of [
   ['.navigation [aria-label="Styles on this page"]','.page-sources-popup.styles'],
   ['.navigation [aria-label="Scripts on this page"]','.page-sources-popup.scripts'],
   ['.navigation [aria-label="Proxy switcher"]','.proxy-popup'],
   ['.navigation [aria-label="Menu"]','.browser-menu'],
   ['[data-workspace-trigger]','.haz-workspace-menu'],
   ['[data-tab-id=research]','.tab-menu'],
  ]){
   const file=join(temporary,'steps.json');
   writeFileSync(file,JSON.stringify({steps:[{action:'key',key:'Escape'},{action:'click',selector:trigger,button:popup==='.tab-menu'?'right':'left'},{action:'assert',selector:popup+':not(.shell-overlay-exit)',exists:true}]}));
   cli(['sequence','--pane',pane,'--file',file]);
   await new Promise(resolve=>setTimeout(resolve,200));
   const inspected=join(temporary,'inspect.json');
   cli(['inspect','--pane',pane,'--selector',popup+':not(.shell-overlay-exit)','--out',inspected]);
   const bounds=JSON.parse(readFileSync(inspected,'utf8')).element.bounds;
   const gaps={left:bounds.x,top:bounds.y,right:1040-bounds.x-bounds.width,bottom:760-bounds.y-bounds.height};
   const passed=Object.values(gaps).every(value=>value>=7.99);
   results.push({pane,popup,gaps,passed});
   if(!passed)throw Error(JSON.stringify(results.at(-1)));
  }
 }
 console.log('12 menu placements keep at least 8 px of window clearance');
}finally{
 writeFileSync(join(output,'menu-edges.json'),JSON.stringify(results,null,2));
 rmSync(temporary,{recursive:true,force:true});
}
