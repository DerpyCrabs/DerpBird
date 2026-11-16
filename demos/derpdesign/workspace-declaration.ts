import { layoutDemo } from './layout-declaration';
export const workspaceDemo = {
 id:'derpbird-workspaces', projectId:'derpbird', name:'Workspaces & pinned tabs',
 description:'Interactive workspace and pinned-tab design across all eight supported chrome arrangements. Demo-local workspace state; production tab controls.',
 panes:[...['sidebar','compact','classic'].map((preset,i)=>({id:`workspace-nine-${preset}`,name:`9 pins · ${preset}`,engine:'ladybird',viewport:{width:1000,height:760,deviceScaleFactor:'display'},position:{x:i*1040,y:4050},route:'/',conditions:{layoutDemo:true,workspaceDemo:true,preset,pinCount:9}})),...layoutDemo.panes.slice(0,8).map(p=>({...p,id:`workspace-${p.id}`,conditions:{...p.conditions,workspaceDemo:true}})),
 ...['sidebar','classic'].map((preset,i)=>({id:`workspace-default-${preset}`,name:`Default only · ${preset}`,engine:'ladybird',viewport:{width:1000,height:760,deviceScaleFactor:'display'},position:{x:i*1040,y:2430},route:'/',conditions:{layoutDemo:true,workspaceDemo:true,preset,singleDefault:true}})),
 ...['edit','create'].map((mode,i)=>({id:`workspace-${mode}`,name:mode==='edit'?'Edit workspace':'Create workspace',engine:'ladybird',viewport:{width:1000,height:760,deviceScaleFactor:'display'},position:{x:i*1040,y:3240},route:'/',conditions:{layoutDemo:true,workspaceDemo:true,preset:'sidebar',workspaceEdit:mode==='edit',workspaceCreate:mode==='create'}}))]
};
