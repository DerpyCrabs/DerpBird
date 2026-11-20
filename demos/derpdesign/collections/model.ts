import { favicon } from '../favicons';

export const reading = [
  ['Dialog', 'ariakit.org', '/components/dialog', 'globe'],
  ['CSS grid layout', 'developer.mozilla.org', '/en-US/docs/Web/CSS/CSS_grid_layout', 'mdn'],
  ['Ladybird browser', 'github.com', '/LadybirdBrowser/ladybird', 'github'],
  ['Navigating a dialog with the keyboard', 'ariakit.org', '/examples/dialog-hide-warning', 'globe'],
  ['Figma Community', 'www.figma.com', '/community', 'figma'],
  [
    'Container queries',
    'developer.mozilla.org',
    '/en-US/docs/Web/CSS/CSS_containment/Container_queries',
    'mdn',
  ],
  ['Ariakit examples', 'ariakit.org', '/examples', 'globe'],
  ['Release notes', 'github.com', '/LadybirdBrowser/ladybird/releases', 'github'],
];
import type { Bookmark } from '@bird/ui/collections/dialogs';
export { inform, type Bookmark } from '@bird/ui/collections/dialogs';
export function bookmark(index: number): Bookmark {
  const [title, host, path, icon] = reading[index];
  return {
    id: 'link-' + index,
    type: 'bookmark',
    title,
    url: 'https://' + host + path,
    favicon: favicon(icon).split(',')[1],
  };
}
