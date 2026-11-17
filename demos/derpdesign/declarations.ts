import {hazTabsDemo} from './haz-tabs/declaration';
import {resolve} from 'node:path';
import {activityDemo} from './ai-activity/declaration';
import {workspaceDemo} from './workspace-declaration';
import {layoutDemo} from './layout-declaration';
import {devtoolsDemo} from './devtools-declaration';
import additionalDemos from './additional-declarations.json';
import proxyDemo from './proxy-declaration.json';
export function declarations({port=47921, projectsRoot, sourceRoot=projectsRoot?resolve(projectsRoot,'DerpBird'):resolve(import.meta.dirname,'../..')}: {port?:number;sourceRoot?:string;projectsRoot?:string;root?:string}={}) {
 const supportRoot=resolve(sourceRoot,'demos/derpdesign');
 const project={id:'derpbird',name:'DerpBird',sourceRoot,supportRoot,server:{command:['bun','x','vite','--config',resolve(supportRoot,'vite.config.ts'),'--port',String(port)],cwd:sourceRoot,url:`http://127.0.0.1:${port}`,readyTimeoutMs:120000}};
 const base={id:'derpbird-shell',projectId:'derpbird',name:'DerpBird shell',description:'Production shell and native boundary fixtures.',panes:[1000,480].map((width,i)=>({id:`derpbird-ladybird-${i?'narrow':'wide'}`,name:i?'Narrow':'Wide',engine:'ladybird',viewport:{width,height:800,deviceScaleFactor:'display'},position:{x:i*1040,y:0},route:'/',conditions:{}}))};
 const variants=[{id:'derpbird-horizontal',name:'Horizontal browser tabs',conditions:{layout:'horizontal'}},{id:'derpbird-proxy',name:'Proxy profile switcher',conditions:{manager:true}}].map(v=>({...base,...v,panes:base.panes.map(p=>({...p,id:`${p.id}-${v.id.split('-').slice(1).join('-')}`,conditions:v.conditions}))}));
 return {project,demos:[base,hazTabsDemo,activityDemo,...variants,workspaceDemo,layoutDemo,devtoolsDemo,proxyDemo,...additionalDemos]};
}
