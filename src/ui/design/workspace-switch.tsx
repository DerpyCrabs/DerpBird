import {Effect} from 'effect';
import { list,mount, modelOwner, view} from 'effectweb';
import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import Layers from '@effectweb/lucide/icons/layers';
import Check from '@effectweb/lucide/icons/check';
import Plus from '@effectweb/lucide/icons/plus';
import {ShellMenu} from '../Overlay';
import type {ShellController} from '../../browser/controller';

/** One named selector instead of two adjacent, unrelated rows of action icons. */
export function mountWorkspaceSwitch(controller: ShellController) {
  const host = document.createElement('div');
  host.className = 'haz-workspace-switch';
  document.querySelector('.tabs')!.append(host);
  const props = (state: ReturnType<typeof controller.state>) => ({spaces: state.browser.workspaces, layout: state.layout});
  const owner = modelOwner({open: false, ...props(controller.state())});
  const trigger = () => host.querySelector<HTMLButtonElement>('[data-workspace-trigger]');
  const stop = controller.source.subscribe(state => owner.patch(props(state)));
  const ui = mount(host, view<ReturnType<typeof owner.read>>(model => {
    const spaces = model.spaces;
    const active = spaces?.items.find(space => space.id === spaces?.active);
    return <>
      <button class="haz-workspace-trigger" type="button" data-workspace-trigger="true"
        aria-label={`Switch workspace: ${active?.name ?? 'Default'}`} aria-haspopup="menu" aria-expanded={model.open}
        onClick={() => owner.patch({open: !model.open})}>
        <Layers size={15}/><span>{active?.name ?? 'Default'}</span><ChevronDown size={13}/>
      </button>
      {model.open ? <ShellMenu class="haz-workspace-menu" aria-label="Workspaces" trigger={trigger}
        anchor={{getBoundingClientRect: () => trigger()!.getBoundingClientRect()}}
        side={model.layout === 'vertical' ? 'top' : 'bottom'} onKeyDown={event => {
          const target=event.target as HTMLElement;
          if((event.key==='Enter'||event.key===' ')&&target.matches('button[role^=menuitem]')){event.preventDefault();target.click();}
        }} onDismiss={() => owner.patch({open: false})}>
        {list(spaces?.items ?? [], space => space.id, space => <button type="button" role="menuitemradio"
          aria-checked={space.id === spaces?.active} onClick={() => {
            owner.patch({open: false}); controller.switchWorkspace(space.id);
          }}><span>{space.name}</span>{space.id === spaces?.active ? <Check size={15}/> : null}</button>)}
        <hr/>
        <button type="button" role="menuitem" onClick={() => {
          owner.patch({open: false}); controller.openWorkspaceEditor();
        }}><Plus size={15}/><span>New workspace</span></button>
      </ShellMenu> : null}
    </>;
  }), owner.source);
  return () => {stop(); ui.dispose(); host.remove(); void Effect.runPromise(owner.close());};
}
