import {resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const session=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
const browser=process.argv.includes('--browser');
const ducks=process.argv.includes('--ducks');
const round2=process.argv.includes('--round2');
const root=resolve(import.meta.dirname,'../../..');
const supportRoot=import.meta.dirname;
const port=session?47939:47938;
const project={id:'derpbird-icons',name:'DerpBird icon explorations',sourceRoot:root,supportRoot,server:{command:['bun','x','vite','--config',resolve(supportRoot,'vite.config.ts'),'--port',String(port)],cwd:root,url:`http://127.0.0.1:${port}`}};
const demo={id:browser?'derpbrowser-icons':ducks?'derpbird-clumsy-ducks':round2?'derpbird-icon-concepts-2':'derpbird-icon-concepts',projectId:project.id,name:browser?'DerpBrowser — 30 browser icons':ducks?'10 clumsy ducks':round2?'20 more DerpBird icons':'20 DerpBird icon concepts',description:'Editable SVG concepts, each at 88, 32 and 16 pixels.',panes:[{id:'bird-icon-sheet',name:browser?'DerpBrowser — 30 browser icons':ducks?'10 clumsy ducks':'20 icon concepts',engine:'ladybird',viewport:{width:1000,height:browser?1800:1300,deviceScaleFactor:'display'},position:{x:0,y:0},route:browser?'/browser.html':ducks?'/ducks.html':round2?'/round2.html':'/',conditions:{}}]};
const tmp=await mkdtemp(resolve(tmpdir(),'bird-icons-'));
async function call(tool:string,params:unknown={}){
 const file=resolve(tmp,'params.json');await Bun.write(file,JSON.stringify(params));
 const child=Bun.spawn(['derpdesign','call',tool,...(session?['--session',session]:[]),'--file',file],{stdout:'pipe',stderr:'pipe'});
 const text=await new Response(child.stdout).text(),error=await new Response(child.stderr).text();if(await child.exited)throw Error(error+text);return JSON.parse(text);
}
try{
 console.log(await call('workspace_info'));
 const projects=await call('project_list');
 if(!projects.some((p:any)=>p.id===project.id))await call('project_register',project);
 else if(session)await call('project_update',project);
 await call('demo_put',demo);
 if(session)await call('selection_set',{projectId:project.id,demoId:demo.id});
 console.log('Registered',demo.id);
}finally{await rm(tmp,{recursive:true});}
