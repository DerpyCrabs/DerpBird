import type { BrowserSnapshot } from './protocol';
type Suggestion = NonNullable<BrowserSnapshot['addressSuggestions']>['items'][number];

/** Display metadata never changes the original navigation target. */
export function suggestionDetails(item: Suggestion): string {
  if (item.subtitle) return item.subtitle;
  if (item.source === 'search') return 'Search the web';
  if (item.text.startsWith('about:')) return item.text;
  try {
    const url = new URL(item.text);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    }
  } catch { /* Search queries are not URLs. */ }
  return item.text === item.title ? 'Search the web' : item.text;
}
