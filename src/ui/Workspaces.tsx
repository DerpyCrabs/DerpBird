import { list } from 'effectweb';
import Search from '@effectweb/lucide/icons/search';
import House from '@effectweb/lucide/icons/house';
import CodeXml from '@effectweb/lucide/icons/code-xml';
import Leaf from '@effectweb/lucide/icons/leaf';
import Plus from '@effectweb/lucide/icons/plus';
import { ShellPopover } from './Overlay';
import type { ShellController, ShellModel } from '../browser/controller';
import { workspaceColors, workspaceIcons, type Workspace } from '../browser/workspaces';
import './workspaces.css';
const symbol = (name: Workspace['icon']) => name === 'home' ? <House size={16}/> : name === 'code' ? <CodeXml size={16}/> : name === 'leaf' ? <Leaf size={16}/> : <Search size={16}/>;
export function workspaceControls(model: ShellModel, controller: ShellController) {
 const spaces=model.browser.workspaces;
 return <nav class="workspace-shortcuts" aria-label="Workspaces" hidden={!spaces || spaces.items.length < 2}>
  {list(spaces?.items ?? [], w=>w.id, w=><button type="button" class={`tone-${w.color}`} title={w.name} aria-label={`Switch to ${w.name}`} aria-pressed={spaces?.active===w.id} onClick={()=>controller.switchWorkspace(w.id)} onContextMenu={e=>{e.preventDefault();controller.openWorkspaceEditor(w.id);}}>{symbol(w.icon)}</button>)}
  <button type="button" aria-label="Create workspace" title="New workspace" onClick={()=>controller.openWorkspaceEditor()}><Plus size={16}/></button>
 </nav>;
}
export function workspaceEditor(model: ShellModel, controller: ShellController) {
 const draft=model.workspaceEditor;
 if(!draft)return null;
 const trigger=()=>Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-trigger], .workspace-shortcuts:not([hidden]) [aria-pressed=true]')).find(element=>element.getBoundingClientRect().width>0) ?? document.querySelector<HTMLElement>('button[aria-label=Menu]');
 const anchor={getBoundingClientRect:()=>{
  const rect=trigger()?.getBoundingClientRect() ?? new DOMRect(8,8,0,0);
  const sidebar=document.querySelector('.vertical .tabs')?.getBoundingClientRect();
  return sidebar ? new DOMRect(sidebar.left+8,rect.top,sidebar.width-16,rect.height) : rect;
 }};
 return <ShellPopover class="workspace-popover" aria-label={draft.id?'Edit workspace':'Create workspace'} side="top" trigger={trigger} anchor={anchor} onDismiss={()=>controller.closeWorkspaceEditor()}>
  <header><strong>{draft.id?'Edit workspace':'New workspace'}</strong></header>
  <form onSubmit={e=>{e.preventDefault();controller.saveWorkspace();}}>
   <input name="workspace-name" aria-label="Workspace name" placeholder="Workspace name" required={true} maxlength={32} value={draft.name} onInput={e=>controller.editWorkspace({name:e.currentTarget.value})}/>
   <div class="workspace-customize">
    <div class={`workspace-symbols tone-${draft.color}`} role="group" aria-label="Workspace icon"><span class="workspace-choice-label">Icon</span>{workspaceIcons.map(icon=><button type="button" aria-label={`${icon} icon`} aria-pressed={draft.icon===icon} onClick={()=>controller.editWorkspace({icon})}>{symbol(icon)}</button>)}</div>
    <div class="workspace-colors" role="group" aria-label="Workspace color"><span class="workspace-choice-label">Color</span>{workspaceColors.map(color=><button type="button" class={`tone-${color}`} aria-label={`${color} color`} aria-pressed={draft.color===color} onClick={()=>controller.editWorkspace({color})}/>)}</div>
   </div>
   <footer><button type="submit" class="workspace-primary">{draft.id?'Save':'Create'}</button></footer>
  </form>
 </ShellPopover>;
}
