// Only the transport is simulated. Each about:settings module handles its normal WebUI events.
import catalog from './catalog.json';
import type { StudyFrame } from './study';
import { layoutFromSettings, layoutToSettings } from '@bird/browser/chrome-layout';
import { bindShellSettings } from '@bird/ui/preferences/settings-page';
const get = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const shell = (window.frameElement as StudyFrame).studyController;
window.addEventListener('DOMContentLoaded', () => bindShellSettings(shell), { once: true });
type Rule = { filter: string; policy: string };
const policies: Record<string, { policy: string; siteFilters: Rule[] }> = {};
for (const setting of ['autoplay', 'geolocation', 'microphone', 'notifications'])
  policies[setting] = { policy: setting === 'autoplay' ? 'block-audio' : 'ask', siteFilters: [] };
const state = {
  appearance: {
    interfaceTheme: shell.state().browser.preferences.theme ?? ('dark' as string),
    websiteColorScheme: 'system',
    colorTheme: 'neutral',
    showBookmarksBar: 'never',
  },
  content: {
    defaultZoomLevelFactor: 1,
    enableForceDark: false,
    zoomPerHost: { 'example.test': 1.25 },
    forceDarkPerHost: { 'example.test': false },
  },
  tabs: { ...layoutToSettings(shell.state().chromeLayout!), verticalTabsExpandOnHover: false },
  browsingBehavior: { enableAutoscroll: true, enablePrimaryPaste: false },
  languages: ['en'],
  searchEngine: {
    engine: 'DuckDuckGo',
    suggestions: false,
    custom: [] as { name: string; url: string; suggestionsUrl: string }[],
  },
  defaultNewTabPageURL: 'about:newtab',
  newTabPageURL: 'about:newtab',
  restorePreviousSession: true,
  crashReportSending: 'ask',
  globalPrivacyControl: false,
  backgroundNetworking: {
    enabled: true,
    features: { contentBlockerSubscriptionUpdates: true, updateChecks: true },
  },
  siteSettings: policies,
  dnsSettings: { mode: 'system' },
  configVariableDefinitions: catalog.config.map((v) => ({ ...v, value: v.defaultValue })),
  contentBlockers: { enabled: true, customFilters: '', disabledSites: ['example.test'] },
  contentBlockerLists: catalog.lists.map((l) => ({
    ...l,
    enabled: ['easyList', 'easyPrivacy'].includes(l.identifier),
  })),
  contentBlockerListUpdateInProgress: false,
};
function emit(name: string, data: unknown) {
  const focused = document.activeElement as HTMLElement | null;
  const languageRow = focused?.closest<HTMLElement>('#languages-list .dialog-list-item');
  const originalIndex = languageRow ? [...languageRow.parentElement!.children].indexOf(languageRow) : -1;
  document.dispatchEvent(new CustomEvent('WebUIMessage', { detail: { name, data: structuredClone(data) } }));
  if (!focused || focused.isConnected) return;
  if (languageRow) {
    const rows = [...document.querySelectorAll<HTMLElement>('#languages-list .dialog-list-item')];
    const label = (row: HTMLElement) => row.querySelector('.dialog-list-item-label')?.textContent;
    const row =
      rows.find((candidate) => label(candidate) === label(languageRow)) ??
      rows[Math.min(originalIndex, rows.length - 1)];
    const buttons = [...(row?.querySelectorAll<HTMLButtonElement>('button:enabled') ?? [])];
    const target =
      buttons.find((button) => button.title === focused.title) ?? buttons[0] ?? get('#languages-select');
    target.focus({ preventScroll: true });
  } else if (focused.id && document.activeElement === document.body) {
    document.getElementById(focused.id)?.focus({ preventScroll: true });
  }
}
const features = { verticalTabs: true, menuBar: true, primaryPaste: true };
const assignKeys: Record<string, keyof typeof state> = {
  setAppearance: 'appearance',
  setContentSettings: 'content',
  setTabSettings: 'tabs',
  setBrowsingBehavior: 'browsingBehavior',
  setLanguages: 'languages',
  setDNSSettings: 'dnsSettings',
  setGlobalPrivacyControl: 'globalPrivacyControl',
  setNewTabPageURL: 'newTabPageURL',
  setRestorePreviousSession: 'restorePreviousSession',
  setCrashReportSending: 'crashReportSending',
};
let cache = 524288,
  siteBytes = 4096;
function refresh() {
  emit('loadSettings', state);
  const vertical = state.tabs.verticalTabsEnabled;
  get('#vertical-tabs-expand-on-hover').parentElement!.classList.toggle('hidden', !vertical);
  get<HTMLInputElement>('#vertical-tabs-expand-on-hover').checked = state.tabs.verticalTabsExpandOnHover;
}
get<HTMLInputElement>('#vertical-tabs-expand-on-hover').onchange = (e) => {
  state.tabs.verticalTabsExpandOnHover = (e.currentTarget as HTMLInputElement).checked;
};
function sendMessage(name: string, value: any) {
  const key = assignKeys[name];
  if (key) {
    Object.assign(state, { [key]: value });
    if (key === 'tabs') shell.setChromeLayout(layoutFromSettings(value));
    if (key === 'appearance') {
      const mode = state.appearance.interfaceTheme;
      const theme =
        mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode;
      if (theme === 'dark' || theme === 'light')
        shell.send({
          type: 'shell.set-appearance',
          theme,
          alwaysClose: shell.state().browser.preferences.alwaysClose !== false,
        });
    }
    refresh();
    return;
  }
  switch (name) {
    case 'loadFeatures':
      emit('loadFeatures', features);
      return;
    case 'loadAvailableEngines':
      emit('loadEngines', { search: catalog.engines });
      return;
    case 'loadForciblyEnabledSiteSettings':
      emit('forciblyEnableSiteSettings', []);
      return;
    case 'loadCrashReportsWaiting':
      emit('crashReportsWaiting', 0);
      return;
    case 'showCrashReports':
      emit('crashReportsStatus', 'No crash reports in this demo.');
      return;
    case 'estimateBrowsingDataSizes':
      emit('estimatedBrowsingDataSizes', {
        totalCacheSize: cache,
        totalSiteDataSize: siteBytes,
        cacheSizeSinceRequestedTime: cache,
        siteDataSizeSinceRequestedTime: siteBytes,
      });
      return;
    case 'clearBrowsingData':
      window.frameElement?.dispatchEvent(new CustomEvent('cleared-demo-data', { detail: value }));
      if (value.cachedFiles) cache = 0;
      if (value.siteData) siteBytes = 0;
      emit('clearedBrowsingData', {});
      return;
    case 'loadCurrentSettings':
    case 'refreshSettings':
      break;
    case 'setSearchEngineSettings':
      Object.assign(state.searchEngine, value);
      break;
    case 'addCustomSearchEngine':
      state.searchEngine.custom.push(value);
      break;
    case 'removeCustomSearchEngine':
      state.searchEngine.custom = state.searchEngine.custom.filter((v) => v.name !== value.name);
      break;
    case 'setSiteSettingPolicy':
      policies[value.setting].policy = value.policy;
      break;
    case 'addSiteSettingFilter':
      policies[value.setting].siteFilters = policies[value.setting].siteFilters
        .filter((v) => v.filter !== value.filter)
        .concat({ filter: value.filter, policy: value.policy });
      break;
    case 'removeSiteSettingFilter':
      policies[value.setting].siteFilters = policies[value.setting].siteFilters.filter(
        (v) => v.filter !== value.filter,
      );
      break;
    case 'removeAllSiteSettingFilters':
      policies[value.setting].siteFilters = [];
      break;
    case 'setConfigVariable': {
      const variable = state.configVariableDefinitions.find((v) => v.name === value.name)!;
      variable.value = value.value;
      break;
    }
    case 'resetHostSetting': {
      const map: Record<string, unknown> =
        value.setting === 'zoom' ? state.content.zoomPerHost : state.content.forceDarkPerHost;
      for (const host of Object.keys(map)) if (!value.host || value.host === host) delete map[host];
      break;
    }
    case 'setServicesNetworkAccessEnabled':
      state.backgroundNetworking.enabled = value;
      break;
    case 'setFilterListUpdatesEnabled':
      state.backgroundNetworking.features.contentBlockerSubscriptionUpdates = value;
      break;
    case 'setUpdateChecksEnabled':
      state.backgroundNetworking.features.updateChecks = value;
      break;
    case 'setContentBlockerEnabled':
      state.contentBlockers.enabled = value;
      break;
    case 'setContentBlockerEnabledForSite':
      state.contentBlockers.disabledSites = state.contentBlockers.disabledSites.filter(
        (s) => s !== value.site,
      );
      break;
    case 'setCustomContentBlockerFilters':
      state.contentBlockers.customFilters = value;
      break;
    case 'setContentBlockerListEnabled':
      state.contentBlockerLists.find((l) => l.identifier === value.identifier)!.enabled = value.enabled;
      break;
    case 'removeContentBlockerList':
      state.contentBlockerLists = state.contentBlockerLists.filter((l) => l.identifier !== value);
      break;
    case 'importLocalContentBlockerList':
    case 'addCustomContentBlockerSubscription': {
      const online = name === 'addCustomContentBlockerSubscription';
      const url = online ? URL.parse(value) : null;
      if (online && (!url || !['https:', 'http:'].includes(url.protocol))) {
        emit('contentBlockerResult', { operation: 'subscription', message: 'Enter an HTTP or HTTPS URL.' });
        return;
      }
      state.contentBlockerLists.push({
        identifier: crypto.randomUUID(),
        name: online ? url!.hostname : value.name,
        url: url?.href ?? '',
        description: online ? 'Subscription' : 'Local file',
        builtIn: false,
        languageSpecific: false,
        enabled: true,
      });
      emit('contentBlockerResult', {
        operation: online ? 'subscription' : 'local',
        message: 'Added to demo lists.',
      });
      break;
    }
    case 'updateContentBlockerLists':
      state.contentBlockerListUpdateInProgress = true;
      setTimeout(() => {
        state.contentBlockerListUpdateInProgress = false;
        refresh();
      }, 600);
      break;
    default:
      throw new Error('Unsupported settings operation: ' + name);
  }
  refresh();
}
Object.defineProperty(window, 'ladybird', { configurable: true, value: { sendMessage } });

