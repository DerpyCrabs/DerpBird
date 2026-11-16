import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {declarations} from '../declarations';
const session=process.argv[2];
const {project}=declarations({port:session?47947:47921});
import {activityDemo as demo} from './declaration';
const dir=await mkdtemp(join(tmpdir(),'bird-activity-'));
async function call(tool:string,params:any={}){const file=join(dir,'params.json');await Bun.write(file,JSON.stringify(params));const p=Bun.spawn(['derpdesign','call',tool,...(session?['--session',session]:[]),'--file',file],{stdout:'pipe',stderr:'pipe'});const text=await new Response(p.stdout).text(),error=await new Response(p.stderr).text();if(await p.exited)throw Error(text+error);return JSON.parse(text)}
try{const projects=await call('project_list');if(!projects.some((p:any)=>p.id===project.id))await call('project_register',project);else if(session)await call('project_update',project);await call('demo_put',demo);if(session)await call('selection_set',{projectId:project.id,demoId:demo.id});console.log(demo.id)}finally{await rm(dir,{recursive:true})}
