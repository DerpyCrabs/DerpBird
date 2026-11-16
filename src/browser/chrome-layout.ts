export interface ChromeLayout {
  readonly preset: 'classic' | 'sidebar' | 'bottom' | 'compact';
  readonly side: 'left' | 'right';
  readonly address: 'top' | 'bottom';
}
export const verticalLayout = (value: ChromeLayout) => value.preset === 'sidebar' || value.preset === 'compact';
export function decodeChromeLayout(value: unknown): ChromeLayout {
  const layout = value as Partial<ChromeLayout> | null;
  if (!layout || !['classic', 'sidebar', 'bottom', 'compact'].includes(layout.preset!) || !['left', 'right'].includes(layout.side!) || !['top', 'bottom'].includes(layout.address!)) throw new Error('Invalid chrome layout');
  return Object.freeze({ preset: layout.preset!, side: layout.side!, address: layout.address! });
}
export function layoutFromSettings(tabs: Record<string, unknown>): ChromeLayout {
  return {preset: tabs.verticalTabsEnabled ? (tabs.everythingInSidebar ? 'compact' : 'sidebar') : (tabs.addressBarOnBottom ? 'bottom' : 'classic'), side: tabs.verticalTabsPosition === 'right' ? 'right' : 'left', address: tabs.addressBarOnBottom ? 'bottom' : 'top'};
}
export function layoutToSettings(value: ChromeLayout) {
  return {verticalTabsEnabled: verticalLayout(value), everythingInSidebar: value.preset === 'compact', verticalTabsPosition: value.side, addressBarOnBottom: value.preset === 'bottom' || (value.preset !== 'classic' && value.address === 'bottom')};
}
