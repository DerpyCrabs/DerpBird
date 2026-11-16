import { list } from 'effectweb';
import { ShellDialog } from './Overlay';
import { Button } from './button';
import X from '@effectweb/lucide/icons/x';
import Search from '@effectweb/lucide/icons/search';
import Globe from '@effectweb/lucide/icons/globe';
import History from '@effectweb/lucide/icons/history';
import Bookmark from '@effectweb/lucide/icons/bookmark';
import type { ChromeLayout, ShellController, ShellModel } from '../browser/controller';
import { paletteItems } from '../browser/address-palette';
type Props = { model: ShellModel; controller: ShellController };
const presets = [
  { id: 'classic', title: 'Classic', description: 'Tabs above the address bar.' },
  { id: 'sidebar', title: 'Side tabs', description: 'Vertical tabs, full-width address bar.' },
  { id: 'bottom', title: 'Bottom address', description: 'Tabs on top, address bar below the page.' },
  { id: 'compact', title: 'Compact sidebar', description: 'Tabs and address together on the side.' },
] as const;
export function LayoutSettings({ value, onChange }: {value: ChromeLayout; onChange: (value: ChromeLayout) => void}) {
  const vertical = value.preset === 'sidebar' || value.preset === 'compact';
  return <section class="layout-settings" aria-label="Browser layout">
    <fieldset class="layout-presets"><legend>Layout</legend><div class="layout-card-grid">{presets.map(preset => <label class={`layout-choice ${value.preset === preset.id ? 'selected' : ''}`}>
      <input type="radio" name="browser-layout" value={preset.id} checked={value.preset === preset.id} onChange={() => onChange({ ...value, preset: preset.id })}/>
      <span class={`layout-mini mini-${preset.id}`} aria-hidden="true"><i class="mini-tabs"/><i class="mini-address"/><i class="mini-page"/></span>
      <strong>{preset.title}</strong><span>{preset.description}</span>
    </label>)}</div></fieldset>
    {vertical ? <fieldset class="layout-position"><legend>Tab sidebar</legend><div>{(['left', 'right'] as const).map(side => <label><input type="radio" name="tab-side" value={side} checked={value.side === side} onChange={() => onChange({ ...value, side })}/><span>{side === 'left' ? 'Left' : 'Right'}</span></label>)}</div></fieldset> : null}
    {value.preset === 'sidebar' ? <fieldset class="layout-position"><legend>Address bar</legend><div>{(['top', 'bottom'] as const).map(address => <label><input type="radio" name="address-position" value={address} checked={value.address === address} onChange={() => onChange({ ...value, address })}/><span>{address === 'top' ? 'Top' : 'Bottom'}</span></label>)}</div></fieldset> : null}
  </section>;
}
export function AddressPalette({ model, controller }: Props) {
  const input = model.addressInput ?? '';
  const items = paletteItems(model);
  const choose = (index: number) => controller.choosePaletteItem(index);
  return <ShellDialog class="address-palette" aria-label="Search or enter address" trigger={() => document.getElementById('compact-location')} onDismiss={() => controller.dismissAddress()}>
    <form onSubmit={event => { event.preventDefault(); choose(model.addressSelection); }}>
      <Search size={20}/><input id="palette-location" aria-label="Search or enter address" placeholder="Search or enter address" value={input} aria-activedescendant={model.addressSelection >= 0 ? `palette-option-${model.addressSelection}` : undefined} role="combobox" aria-expanded={items.length > 0} aria-controls="palette-results" autocomplete="off" spellcheck={false} onFocus={event => event.currentTarget.select()} onInput={event => { event.currentTarget.removeAttribute('aria-activedescendant'); controller.editAddress(event.currentTarget.value); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controller.selectPaletteItem(event.key === 'ArrowDown' ? 1 : -1); } }}/><Button type="button" variant="ghost" size="icon" aria-label="Close address palette" onClick={() => controller.dismissAddress()}><X size={16}/></Button>
    </form>
    <div id="palette-results" role="listbox" aria-label="Suggestions">{list(items, item => `${item.source}:${item.id}`, (item, index) => <button type="button" role="option" id={`palette-option-${index}`} data-index={index} aria-selected={model.addressSelection === index} onClick={() => choose(index)}><span class="suggestion-icon">{item.source === 'history' ? <History size={17}/> : item.source === 'bookmark' ? <Bookmark size={17}/> : item.source === 'search' ? <Search size={17}/> : <Globe size={17}/>}</span><span class="suggestion-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span class="palette-action">{item.source === 'tab' ? 'Switch to tab' : 'Open'} ↵</span></button>)}</div>
    <footer><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
  </ShellDialog>;
}
