import {hazTabsDemo} from './declaration';
import {declarations} from '../declarations';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const session=process.argv[2];
const directory=await mkdtemp(join(tmpdir(),'haz-tabs-'));
async function call(name:string,params:unknown){const file=join(directory,'params.json');await Bun.write(file,JSON.stringify(params));const p=Bun.spawn(['derpdesign','call',name,...(session?['--session',session]:[]),'--file',file],{stdout:'inherit',stderr:'inherit'});if(await p.exited)throw Error(name+' failed');}
try{
 if(session)await call('project_update',declarations({port:47947}).project);
 await call('demo_put',hazTabsDemo);
 if(session)await call('selection_set',{projectId:'derpbird',demoId:hazTabsDemo.id});
}finally{await rm(directory,{recursive:true});}
