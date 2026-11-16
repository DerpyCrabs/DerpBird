import { Effect } from 'effect';
import { mount, modelOwner, view } from 'effectweb';
import { LayoutSettings } from './ui/BrowserLayout';
import { layoutFromSettings, layoutToSettings, type ChromeLayout } from './browser/chrome-layout';
import layoutCSS from './ui/browser-layout-settings.css?inline';

/** Shared by the native Settings document and the deterministic demo bridge. */
export function mountSettingsLayout(document: Document, send: (name: string, value: unknown) => void) {
  const host = document.querySelector<HTMLElement>('#tab-layout-group');
  if (!host) throw new Error('Settings layout host is missing');
  const owner = modelOwner<{value: ChromeLayout}>({value: layoutFromSettings({})});
  let tabs: Record<string, unknown> = {};
  const style = document.createElement('style');
  style.textContent = layoutCSS;
  document.head.append(style);
  host.replaceChildren();
  const mounted = mount(host, view<{value: ChromeLayout}>(model => LayoutSettings({value:model.value,onChange:value=>{
    tabs = {...tabs,...layoutToSettings(value)};
    owner.patch({value:layoutFromSettings(tabs)});
    send('setTabSettings', tabs);
  }})), owner.source);
  const message = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.name === 'loadSettings' && detail.data?.tabs) {
      tabs = {...detail.data.tabs};
      owner.patch({value:layoutFromSettings(tabs)});
    }
    if (detail?.name === 'loadFeatures') host.classList.toggle('hidden', !detail.data?.verticalTabs);
  };
  document.addEventListener('WebUIMessage', message);
  return {dispose(){document.removeEventListener('WebUIMessage',message);mounted.dispose();void Effect.runPromise(owner.close());style.remove();}};
}

if (document.querySelector('#tab-layout-group')) {
  const ui = mountSettingsLayout(document, (name,value) => window.ladybird!.sendMessage(name,value));
  window.addEventListener('pagehide',()=>ui.dispose(),{once:true});
}
