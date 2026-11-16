import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {declarations} from './declarations';
const args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const session=option('--session'),activate=option('--activate');
if(activate&&!session)throw Error('Activation is only supported in an owned --session. Select desktop demos in DerpDesign.');
const directory=await mkdtemp(join(tmpdir(),'derpbird-demos-'));
async function call(name:string,params:unknown={}){
 const file=join(directory,'params.json');await Bun.write(file,JSON.stringify(params));
 const child=Bun.spawn(['derpdesign','call',name,...(session?['--session',session]:[]),'--file',file],{stdout:'pipe',stderr:'pipe'});
 const output=await new Response(child.stdout).text(),error=await new Response(child.stderr).text();if(await child.exited)throw Error(error+output);return JSON.parse(output);
}
try{
 const {project,demos}=declarations({port:Number(option('--port')??47921)});
 const projects=await call('project_list');
 if(session)await call('selection_set',{projectId:null,demoId:null});
 await call(projects.some((p:any)=>p.id===project.id)?'project_update':'project_register',project);
 for(const demo of demos)await call('demo_put',demo);
 if(activate)await call('selection_set',{projectId:project.id,demoId:activate});
 console.log(`Registered ${demos.length} DerpBird demos from ${project.supportRoot}`);
}finally{await rm(directory,{recursive:true});}
