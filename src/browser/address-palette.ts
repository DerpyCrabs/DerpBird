import type { ShellModel } from './controller';
import { suggestionDetails } from './address-suggestions';
export function paletteItems(model: ShellModel) {
  const input = model.paletteFilter ?? model.addressInput ?? '';
  const active = model.browser.tabs.find(tab => tab.id === model.browser.activeTabId);
  const query = input === active?.url ? '' : input.trim().toLocaleLowerCase();
  // A private tab must never surface normal-window tab titles or URLs.
  const openTabs = model.browser.tabs.filter(tab => tab.id !== active?.id && tab.private === (active?.private ?? false) && (!query || `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query))).slice(0, 3);
  const remote = model.addressSuggestionsOpen ? model.browser.addressSuggestions?.items ?? [] : [];
  return [
    ...openTabs.map(tab => ({key:`tab:${tab.id}`,id:tab.id,title:tab.title,text:tab.url,detail:tab.url,favicon:tab.favicon,source:'tab'})),
    ...remote.map(item => ({
      ...item,
      id: item.text,
      key: item.source === 'search' && item.text.trim() === input.trim()
        ? 'current-query'
        : `suggestion:${item.source}:${item.text}`,
      detail: suggestionDetails(item),
    })),
  ];
}

export function paletteFavicon(item: ReturnType<typeof paletteItems>[number], isPrivate: boolean) {
  if (item.favicon) return item.favicon;
  if (isPrivate || item.source === 'search' || !/^https?:\/\//i.test(item.text)) return;
  try {
    return new URL('/favicon.ico', item.text).href;
  } catch { return; }
}
