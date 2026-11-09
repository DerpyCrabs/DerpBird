import { createPopover, PopoverPopup, createDialog, DialogPopup, createMenu, MenuPopup, type OverlayHandle, type OverlayChangeCause } from '@effectweb/base-ui';
import { controllerView, modelOwner, view, type JSX } from 'effectweb';
import { observeShellDismissal, shouldRestoreShellFocus } from '../browser/shell-interaction';

type Props = {
  readonly children?: JSX.Element;
  readonly class?: string;
  readonly id?: string;
  readonly style?: JSX.IntrinsicElements['div']['style'];
  readonly 'aria-label'?: string;
  readonly tabindex?: number;
  readonly onKeyDown?: JSX.EventHandler<HTMLElement, KeyboardEvent>;
  readonly onDismiss: (reason: OverlayChangeCause['reason']) => void;
  readonly trigger?: () => HTMLElement | null | undefined;
  readonly initialFocus?: boolean | 'surface';
  readonly anchor?: { readonly getBoundingClientRect: () => DOMRect };
};
// Base UI owns light dismissal, Escape, focus containment, positioning and
// keyboard navigation. This adapter only joins its lifetime to a conditional
// shell view and forwards deactivation from the separate native page surface.
function surface(kind: 'popover' | 'menu' | 'dialog') {
  return controllerView({ controller: (props: Props) => {
    const owner = modelOwner({ props });
    const create = kind === 'dialog' ? createDialog : kind === 'menu' ? createMenu : createPopover;
    const handle: OverlayHandle = create({ id: props.id, open: true, modal: kind === 'dialog', onOpenChange: (open, details) => { if (!open) owner.read().props.onDismiss(details.reason); } });
    handle.attachTrigger(props.trigger?.() ?? undefined);
    owner.own(handle.lifetime);
    if (kind !== 'dialog') owner.own(observeShellDismissal({ deactivate: () => handle.hide({ reason: 'focus-out', event: new Event('blur') }) }));
    return { source: owner.source, lifetime: owner, handle, receive: (next: Props) => { owner.patch({ props: next }); handle.attachTrigger(next.trigger?.() ?? undefined); } };
  } }, view(model => {
    const { onDismiss: _, trigger: __, initialFocus, anchor, children, ...props } = model.props;
    const handle = model.actions.handle;
    const firstFocus = initialFocus === 'surface' ? () => handle.popup() : initialFocus;
    const finalFocus = () => shouldRestoreShellFocus();
    if (kind === 'dialog') return <DialogPopup {...props} dialog={handle} initialFocus={firstFocus} finalFocus={finalFocus}>{children}</DialogPopup>;
    if (kind === 'menu') return <MenuPopup {...props} menu={handle as ReturnType<typeof createMenu>} anchor={anchor} side="bottom" align="end" initialFocus={firstFocus} finalFocus={finalFocus}>{children}</MenuPopup>;
    return <PopoverPopup {...props} popover={handle} anchor={anchor} side="bottom" align="end" initialFocus={firstFocus} finalFocus={finalFocus}>{children}</PopoverPopup>;
  }));
}
export const ShellPopover = surface('popover');
export const ShellMenu = surface('menu');
export const ShellDialog = surface('dialog');
