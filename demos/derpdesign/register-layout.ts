import {resolve} from 'node:path';
import {layoutDemo} from './layout-declaration';
import {declarations} from './declarations';
const session=process.argv[2];
if(!session)throw Error('Pass an owned headless session file');
async function call(name:string,params:unknown){const path='/tmp/derpbird-layout-params.json';await Bun.write(path,JSON.stringify(params));const p=Bun.spawn(['derpdesign','call',name,'--session',session,'--file',path],{stdout:'pipe',stderr:'pipe'});const output=await new Response(p.stdout).text();const error=await new Response(p.stderr).text();if(await p.exited)throw Error(error+output);console.log(name,output.slice(0,250));}
const {project}=declarations({port:47937});
await call('project_update',project);
await call('demo_put',layoutDemo);
await call('selection_set',{projectId:'derpbird',demoId:layoutDemo.id});
