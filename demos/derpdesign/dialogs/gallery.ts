import type { ShellDialog } from '@bird/browser/protocol';
import { mountShellDialogs } from '@bird/ui/ShellDialogs';
import type { ShellController } from '@bird/browser/controller';

type Example = Omit<ShellDialog, 'id'|'value'|'action'> & Partial<Pick<ShellDialog,'value'|'action'>>;
const groups: Record<string, Example[]> = {
  close: [
    {kind:'window-close',title:'Research notes',message:'Changes you made may not be saved.'},
    {kind:'leave',title:'Research notes',message:'Changes you made may not be saved.'},
  ],
  scripts: [
    {kind:'alert',title:'example.test',message:'Your draft was saved.',offerBlock:true},
    {kind:'confirm',title:'example.test',message:'Discard this draft?',offerBlock:true},
    {kind:'prompt',title:'example.test',message:'Name this draft',value:'Research notes',offerBlock:true},
  ],
  permissions: [
    {kind:'permission',title:'Location permission',message:'Allow example.test to access your location?',once:true,action:'Always allow'},
    {kind:'permission-notice',title:'Location blocked',message:'Location access is blocked for example.test.'},
    {kind:'external',title:'Open external application?',message:'Open this link in your mail application?',action:'Open'},
  ],
  downloads: [
    {kind:'downloads',title:'Cancel active downloads?',message:'One download is still in progress.',action:'Cancel downloads'},
    {kind:'download',title:'Download complete',message:'research-notes.pdf',action:'Open folder'},
  ],
  bookmarks: [
    {kind:'bookmark',title:'Edit bookmark',message:'',value:'Research notes',url:'https://example.test/notes',folders:[{id:'work',name:'Work'}],removable:true,action:'Save'},
    {kind:'bookmark-folder',title:'Edit folder',message:'',value:'Research',action:'Save'},
  ],
  values: [
    {kind:'color',title:'Choose color',message:'',value:'#849b8c'},
    ...Object.entries({date:'2026-11-21',time:'10:30',month:'2026-11',week:'2026-W47','datetime-local':'2026-11-21T10:30'}).map(([kind,value])=>({kind,value,title:'Choose '+kind,message:''})),
  ],
  processes: [{kind:'processes',title:'Task manager',message:'',processes:[
    {id:1,pid:4210,name:'Browser',cpu:1.1,bytes:62000000,canEnd:false,pages:[]},
    {id:2,pid:4211,name:'WebContent',cpu:2.4,bytes:98000000,canEnd:true,pages:['Research notes']},
  ]}],
};

export function mountGallery(group:string, controller:ShellController,setDialog:(d?:ShellDialog)=>void){
  const stop=mountShellDialogs(controller);
  const menu=document.createElement('section');
  menu.className='preferences-theme';
  menu.style.cssText='padding:24px;display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px';
  document.querySelector('#content-surface')!.append(menu);
  const examples=groups[group];
  const show=(item:Example)=>setDialog({value:'',action:'',...item,id:item.kind+'-'+item.title});
  for(const item of examples){
    const button=document.createElement('button');
    button.className='pref-button'; button.textContent=item.title==='Research notes' || item.title==='example.test'?item.kind:item.title;
    button.onclick=()=>show(item); menu.append(button);
  }
  show(examples[0]);
  return ()=>{stop();menu.remove();};
}
