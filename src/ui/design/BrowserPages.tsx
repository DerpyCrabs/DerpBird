import { Effect } from 'effect';
import { list, mount, modelOwner, view } from 'effectweb';
import Search from '@effectweb/lucide/icons/search';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import Settings from '@effectweb/lucide/icons/settings';
import ArrowLeft from '@effectweb/lucide/icons/arrow-left';
import { LayoutSettings as renderLayoutSettings } from '../BrowserLayout';
import {
  PreferenceSection as renderSection,
  PreferenceField as renderField,
  PreferenceCheckbox as renderCheckbox,
  PreferencesDialog as renderDialog,
} from '../PreferencesPrimitives';
import type { ShellController, ChromeLayout } from '../../browser/controller';
import '../browser-layout-settings.css';
import './tabs.css';
import './settings.css';
import './toolbar.css';

const LayoutSettings = view(renderLayoutSettings),
  PreferenceSection = view(renderSection),
  PreferenceField = view(renderField),
  PreferenceCheckbox = view(renderCheckbox),
  PreferencesDialog = view(renderDialog);

type BrowserPage = 'start' | 'appearance' | 'tabs' | 'workspaces';
interface BrowserPageOptions {
  initialPage?: BrowserPage;
  initialModal?: boolean;
  standalone?: boolean;
  onOpenSettings?: () => void;
  onOpenStart?: () => void;
  onOpenAllSettings?: () => void;
}
const categories = [
  ['appearance', 'Appearance'],
  ['tabs', 'Tabs & navigation'],
  ['workspaces', 'Workspaces'],
] as const;
function activeWorkspace(controller: ShellController) {
  const spaces = controller.state().browser.workspaces;
  return spaces?.items.find((space) => space.id === spaces.active);
}
function pagePreferences(controller: ShellController) {
  const state = controller.state();
  return {
    name: activeWorkspace(controller)?.name ?? 'Default',
    tabs: state.browser.tabs,
    workspaces: state.browser.workspaces,
    layout: state.chromeLayout!,
    theme: state.browser.preferences.theme ?? 'dark',
    alwaysClose: state.browser.preferences.alwaysClose !== false,
    wrap: state.wrapTabs,
    sidebarWidth: state.sidebarWidth,
  };
}
export function mountBrowserPages(
  controller: ShellController,
  options: BrowserPageOptions = {},
) {
  document.body.classList.add('haz-proposal', 'preferences-theme');
  if (options.standalone) document.body.classList.add('haz-settings-only');
  const initial = pagePreferences(controller);
  const owner = modelOwner({
    ...initial,
    page: options.initialPage ?? 'start',
    modal: options.initialModal === true,
    draft: initial.name,
    error: '',
    notice: '',
  });
  const surface = document.querySelector<HTMLElement>('#content-surface')!;
  // Product start/settings content; host placement is shared with the demo boundary.
  const host = document.createElement('div');
  host.className = 'haz-page-host';
  surface.append(host);
  const openRename = () =>
    owner.patch({ modal: true, draft: owner.read().name, error: '' });
  const setTheme = (theme: 'dark' | 'light') =>
    controller.send({
      type: 'shell.set-appearance',
      theme,
      alwaysClose: owner.read().alwaysClose,
    });
  const setLayout = (layout: ChromeLayout) => {
    if (layout) {
      controller.setChromeLayout(layout);
      owner.patch({ layout });
    }
  };
  const stop = controller.source.subscribe(() => {
    const state = controller.state();
    owner.patch(pagePreferences(controller));
    if (
      state.browser.tabs.find((t) => t.id === state.browser.activeTabId)
        ?.url === 'about:settings' &&
      owner.read().page === 'start'
    )
      owner.patch({ page: 'appearance' });
  });
  const save = () => {
    const name = owner.read().draft.trim();
    if (!name) {
      owner.patch({ error: 'Enter a workspace name.' });
      return;
    }
    if (name.length > 32) {
      owner.patch({ error: 'Use 32 characters or fewer.' });
      return;
    }
    const space = activeWorkspace(controller);
    if (space)
      controller.send({
        type: 'workspace.update',
        id: space.id,
        name,
        icon: space.icon,
        color: space.color,
      });
    owner.patch({ name, modal: false, notice: 'Workspace renamed.' });
  };
  const ui = mount(
    host,
    view<ReturnType<typeof owner.read>>((m) => (
      <div
        class="haz-page preferences-theme"
        data-theme={m.theme === 'light' ? 'light' : 'dark'}
      >
        {m.page === 'start' ? (
          <main class="haz-start">
            <header>
              <span class="haz-wordmark">DerpBird</span>
              <button
                class="pref-icon-button"
                aria-label="Open settings"
                onClick={() =>
                  options.onOpenSettings
                    ? options.onOpenSettings()
                    : owner.patch({ page: 'appearance' })
                }
              >
                <Settings size={18} />
              </button>
            </header>
            <div class="haz-start-content">
              <p class="haz-eyebrow">{m.name}</p>
              <h1>Where to next?</h1>
              <button
                class="haz-search"
                onClick={() => controller.openAddressPalette()}
              >
                <Search size={18} />
                <span>Search or enter address</span>
                <kbd>Ctrl L</kbd>
              </button>
              <nav class="haz-favorites" aria-label="Pinned sites">
                {list(m.tabs.filter((t) => t.pinned), t => t.id, (t) => (
                    <button
                      onClick={() =>
                        controller.send({ type: 'tab.activate', tabId: t.id })
                      }
                    >
                      {t.favicon ? <img src={t.favicon} alt="" /> : null}
                      <span>{t.title}</span>
                    </button>
                  ))}
              </nav>
              <h2>Open in this workspace</h2>
              <div class="haz-reading-list">
                {list(m.tabs.filter((t) => !t.pinned).slice(0, 5), t => t.id, (t) => (
                    <button
                      onClick={() =>
                        controller.send({ type: 'tab.activate', tabId: t.id })
                      }
                    >
                      <span>
                        <strong>{t.title}</strong>
                        <small>{t.url.replace(/^https?:\/\//, '')}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
              </div>
            </div>
          </main>
        ) : (
          <main class="haz-settings">
            <header class="haz-settings-heading">
              <div>
                <button
                  class="pref-icon-button"
                  aria-label="Back to new tab"
                  onClick={() =>
                    options.onOpenStart
                      ? options.onOpenStart()
                      : owner.patch({ page: 'start' })
                  }
                >
                  <ArrowLeft size={18} />
                </button>
                <h1>Settings</h1>
              </div>
              <span>DerpBird</span>
            </header>
            <div class="haz-settings-layout">
              <nav class="haz-settings-nav" aria-label="Settings categories">
                {list(categories, ([id]) => id, ([id, label]) => (
                  <button
                    aria-current={m.page === id ? 'page' : undefined}
                    onClick={() => owner.patch({ page: id })}
                  >
                    {label}
                  </button>
                ))}
                {options.onOpenAllSettings ? (
                  <button onClick={options.onOpenAllSettings}>
                    All browser settings
                  </button>
                ) : null}
              </nav>
              <div class="haz-settings-main">
                <header class="haz-section-title">
                  <h2>
                    {m.page === 'appearance'
                      ? 'Appearance'
                      : m.page === 'tabs'
                        ? 'Tabs & navigation'
                        : 'Workspaces'}
                  </h2>
                  <p>
                    {m.page === 'appearance'
                      ? 'Make the browser feel at home.'
                      : m.page === 'tabs'
                        ? 'A familiar way to move through your day.'
                        : 'Keep related tabs together, with a space for each project.'}
                  </p>
                </header>
                {m.page === 'appearance' ? (
                  <>
                    <PreferenceSection
                      title="Theme"
                      description="Choose how the browser looks."
                    >
                      <div
                        class="haz-themes"
                        role="group"
                        aria-label="Color theme"
                      >
                        {list(['dark', 'light'] as const, (t) => (
                          <button
                            aria-pressed={m.theme === t}
                            onClick={() => setTheme(t)}
                          >
                            <span
                              class={`haz-theme-preview theme-${t}`}
                              aria-hidden="true"
                            >
                              <i />
                              <i />
                              <i />
                            </span>
                            <span>{t === 'dark' ? 'Dark' : 'Light'}</span>
                            <span class="haz-radio" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </PreferenceSection>
                    <PreferenceSection
                      title="Browser layout"
                      description="Keep your tabs above the page or beside it."
                    >
                      <LayoutSettings value={m.layout} onChange={setLayout} />
                    </PreferenceSection>
                  </>
                ) : m.page === 'tabs' ? (
                  <>
                    <PreferenceSection title="Tab controls">
                      <PreferenceCheckbox
                        id="always-close"
                        label="Always show close buttons"
                        description="Keep the close action visible on every tab."
                        checked={m.alwaysClose}
                        onChange={(v) =>
                          controller.send({
                            type: 'shell.set-appearance',
                            theme: owner.read().theme,
                            alwaysClose: v,
                          })
                        }
                      />
                      <PreferenceCheckbox
                        id="wrap-tabs"
                        label="Wrap horizontal tabs"
                        description="Use another row when the tab strip is full."
                        checked={m.wrap}
                        onChange={(v) => {
                          owner.patch({ wrap: v });
                          controller.setWrapTabs(v);
                        }}
                      />
                    </PreferenceSection>
                    <PreferenceSection
                      title="Sidebar width"
                      description="Give longer page titles a little more space."
                    >
                      <div class="pref-fields">
                        <PreferenceField
                          id="sidebar-width"
                          label="Width"
                          description="Applies to layouts with vertical tabs."
                        >
                          <select
                            id="sidebar-width"
                            value={String(m.sidebarWidth)}
                            aria-describedby="sidebar-width-description"
                            onChange={(e) =>
                              controller.setSidebarWidth(
                                Number(e.currentTarget.value),
                              )
                            }
                          >
                            <option value="240">Comfortable · 240 px</option>
                            <option value="196">Compact · 196 px</option>
                            <option value="280">Wide · 280 px</option>
                          </select>
                        </PreferenceField>
                      </div>
                    </PreferenceSection>
                  </>
                ) : (
                  <>
                    <PreferenceSection title="Current workspace">
                      <div class="haz-workspace-row">
                        <div>
                          <strong>{m.name}</strong>
                          <p>{m.tabs.length} tabs</p>
                        </div>
                        <button
                          id="rename-workspace"
                          class="pref-button"
                          onClick={openRename}
                        >
                          Rename workspace
                        </button>
                      </div>
                    </PreferenceSection>
                    <PreferenceSection title="Switch workspace">
                      <div class="haz-workspace-list">
                        {list(m.workspaces?.items ?? [], w => w.id, (w) => (
                            <button
                              class="pref-button"
                              onClick={() => controller.switchWorkspace(w.id)}
                              aria-pressed={
                                w.id ===
                                m.workspaces?.active
                              }
                            >
                              {w.name}
                              <span>
                                {w.id ===
                                m.workspaces?.active
                                  ? 'Current'
                                  : 'Switch'}
                              </span>
                            </button>
                          ))}
                      </div>
                    </PreferenceSection>
                  </>
                )}
                <p class="haz-save-status" role="status">
                  {m.notice || 'Changes are saved automatically.'}
                </p>
              </div>
            </div>
          </main>
        )}
        {m.modal ? (
          <PreferencesDialog
            theme={m.theme === 'light' ? 'light' : 'dark'}
            id="rename"
            title="Rename workspace"
            description="Choose a name that makes this space easy to find."
            trigger={() => document.querySelector('#rename-workspace')}
            initialFocus={() => document.querySelector('#workspace-new-name')}
            onDismiss={() => owner.patch({ modal: false })}
          >
            <form
              novalidate
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div class="pref-fields">
                <PreferenceField
                  id="workspace-new-name"
                  label="Workspace name"
                  description="Up to 32 characters."
                  error={m.error}
                >
                  <input
                    id="workspace-new-name"
                    value={m.draft}
                    aria-invalid={!!m.error}
                    aria-describedby={`workspace-new-name-description${m.error ? ' workspace-new-name-error' : ''}`}
                    onInput={(e) =>
                      owner.patch({ draft: e.currentTarget.value, error: '' })
                    }
                  />
                </PreferenceField>
              </div>
              <footer>
                <button
                  type="button"
                  class="pref-button ghost"
                  onClick={() => owner.patch({ modal: false })}
                >
                  Cancel
                </button>
                <button type="submit" class="pref-button primary">
                  Save changes
                </button>
              </footer>
            </form>
          </PreferencesDialog>
        ) : null}
      </div>
    )),
    owner.source,
  );
  return () => {
    stop();
    ui.dispose();
    host.remove();
    void Effect.runPromise(owner.close());
    document.body.classList.remove('haz-settings-only');
  };
}
