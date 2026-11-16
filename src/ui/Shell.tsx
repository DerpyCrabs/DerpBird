import { workspaceControls, workspaceEditor } from './Workspaces';
import { AddressPalette } from './BrowserLayout';
import { ShellMenu, ShellPopover, ShellDialog } from './Overlay';
import Palette from '@effectweb/lucide/icons/palette';
import CodeXml from '@effectweb/lucide/icons/code-xml';
import type { SourceKind } from '../browser/page-sources';
import { tabUnits, splitFor } from '../browser/splits';
import type { CapturedCredential } from '../browser/credential-protocol';
import { list, view } from 'effectweb';
import { Button } from './button';
import ArrowLeft from '@effectweb/lucide/icons/arrow-left';
import ArrowRight from '@effectweb/lucide/icons/arrow-right';
import RotateCw from '@effectweb/lucide/icons/rotate-cw';
import Plus from '@effectweb/lucide/icons/plus';
import X from '@effectweb/lucide/icons/x';
import Menu from '@effectweb/lucide/icons/menu';
import Volume2 from '@effectweb/lucide/icons/volume-2';
import VolumeX from '@effectweb/lucide/icons/volume-x';
import SlidersHorizontal from '@effectweb/lucide/icons/sliders-horizontal';
import Search from '@effectweb/lucide/icons/search';
import Globe from '@effectweb/lucide/icons/globe';
import History from '@effectweb/lucide/icons/history';
import Bookmark from '@effectweb/lucide/icons/bookmark';
import { suggestionDetails } from '../browser/address-suggestions';
import File from '@effectweb/lucide/icons/file';
import LoaderCircle from '@effectweb/lucide/icons/loader-circle';
import Pin from '@effectweb/lucide/icons/pin';
import type { ShellController, ShellModel } from '../browser/controller';

export function shellView(controller: ShellController, openStyles?: () => void, openScripts?: () => void, openCredentials?: (proposal?: CapturedCredential) => void, openImport?: () => void, autofill?: (token: string, id?: string) => void, openProxy?: () => void, openPageSources?: (kind: SourceKind) => void) {
  return view<ShellModel>(model => {
    const arrangement = model.chromeLayout;
    const compact = arrangement?.preset === 'compact';
    const bottomAddress = arrangement?.preset === 'bottom' || (arrangement?.preset === 'sidebar' && arrangement.address === 'bottom');
    const login = model.browser.credentialAutofill;
    const active = model.browser.tabs.find(tab => tab.id === model.browser.activeTabId);
    const addressSuggestions = model.addressSuggestionsOpen && model.browser.addressSuggestions ? model.browser.addressSuggestions.items : [];
    const log = model.browser.blockingLog;
    const query = model.blockingSearch.toLocaleLowerCase();
    const blocked = log?.tabId === active?.id ? log?.entries.filter(row => `${row.url} ${row.kind} ${row.rule ?? ''}`.toLocaleLowerCase().includes(query)).toReversed() ?? [] : [];
    const contextIndex = model.browser.tabs.findIndex(tab => tab.id === model.tabMenu?.tabId);
    const contextTab = model.browser.tabs[contextIndex];
    const contextSiblings = model.browser.tabs.filter(tab => tab.parentId === contextTab?.parentId && tab.pinned === contextTab?.pinned);
    const contextSiblingIndex = contextSiblings.findIndex(tab => tab.id === contextTab?.id);
    const parents = new Set(model.browser.tabs.flatMap(tab => tab.parentId ? [tab.parentId] : []));
    const units = tabUnits(model.browser);
    const activeSplit = splitFor(model.browser, active?.id);
    const contextSplit = splitFor(model.browser, contextTab?.id);
    const openTabMenu = (tabId: string, x: number, y: number) => {
      controller.openTabMenu(tabId, Math.max(8, Math.min(x, window.innerWidth - 250)), Math.max(8, Math.min(y, window.innerHeight - 240)));

    };
    const tabCommand = (type: 'tab.inspect' | 'tab.back' | 'tab.forward' | 'tab.reload' | 'tab.stop' | 'tab.find' | 'tab.bookmark' | 'tab.site-settings' | 'tab.zoom-in' | 'tab.zoom-out' | 'tab.zoom-reset') => {
      if (active) controller.send({ type, tabId: active.id });
    };
    const renderTabUnit = (unit: ReturnType<typeof tabUnits>[number]) => <div class={`tab-unit ${unit.tabs.every(tab => tab.pinned) ? 'pinned-tab-unit' : ''} ${unit.tabs.length === 2 ? 'split-tab' : ''}`}>{list(unit.tabs, tab => tab.id, tab => <div class={`tab ${unit.tabs.some(member => member.id === model.browser.activeTabId) ? 'active' : ''} ${tab.parentId ? 'tree-child' : ''} ${parents.has(tab.id) ? 'tree-root' : ''}`}
            data-group={tab.parentId ?? (parents.has(tab.id) ? tab.id : undefined)}
            data-group-end={tab.parentId && model.browser.tabs[model.browser.tabs.indexOf(tab) + 1]?.parentId !== tab.parentId ? 'true' : undefined}
            draggable={false} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); controller.send({ type: 'tab.close', tabId: tab.id }); } }} onContextMenu={event => { event.preventDefault(); openTabMenu(tab.id, event.clientX, event.clientY); }}>

            <button role="tab" aria-label={tab.title || 'New tab'} aria-busy={tab.loading} data-tab-id={tab.id} onKeyDown={event => {
              if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openTabMenu(tab.id, rect.left, rect.bottom);
                return;
              }
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const previousKey = model.layout === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
              const nextKey = model.layout === 'vertical' ? 'ArrowDown' : 'ArrowRight';
              if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const tabs = Array.from(event.currentTarget.closest('[role=tablist]')!.querySelectorAll<HTMLButtonElement>('[role=tab]'));
              const index = tabs.indexOf(event.currentTarget);
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === previousKey ? -1 : 1) + tabs.length) % tabs.length;
              // Focus follows the keyboard immediately; selection remains native-authoritative.
              tabs[target]?.focus();
              const tabId = tabs[target]?.dataset.tabId;
              if (tabId) controller.send({ type: 'tab.activate', tabId, focus: 'tab' });
            }} tabindex={tab.id === model.browser.activeTabId ? 0 : -1} aria-selected={tab.id === model.browser.activeTabId} onClick={() => controller.send({ type: 'tab.activate', tabId: tab.id })} title={model.tabMenu ? undefined : `${tab.title || 'New tab'}\n${tab.url}`}>
              <span class="tab-icon" aria-hidden="true">{tab.loading ? <LoaderCircle class="tab-loading" size={16}/> : tab.favicon ? <img class="tab-favicon" src={tab.favicon} alt=""/> : tab.pinned ? <Pin size={13}/> : <File class="tab-placeholder" size={16}/>}</span>
              <span class="tab-title">{tab.title || 'New tab'}</span>{tab.muted ? <VolumeX size={13} aria-label="Muted"/> : tab.audible ? <Volume2 size={13} aria-label="Playing audio"/> : null}{tab.private ? <span aria-label="Private">◈</span> : null}
            </button>
            {!tab.pinned ? <button class="close-tab" aria-label={`Close ${tab.title || 'tab'}`} onClick={() => controller.send({ type: 'tab.close', tabId: tab.id })}><X size={13}/></button> : null}
          </div>)}</div>;
    const pins = model.browser.tabs.filter(tab => tab.pinned).length;
    const columns = Math.max(1, Math.min(6, pins, model.layout === 'horizontal' ? 6 : Math.floor(((model.sidebarResizeWidth ?? model.sidebarWidth) - 8) / 36)));
    return <main class={`shell ${pins > columns ? 'has-pin-rows' : ''} ${model.layout} ${model.wrapTabs ? 'wrap-tabs' : ''} ${arrangement ? `chrome-layout tabs-${arrangement.side} ${bottomAddress ? 'address-bottom' : ''} ${compact ? 'compact-chrome' : ''}` : ''}`} style={{ '--pin-columns': columns, '--sidebar-width': `${model.sidebarResizeWidth ?? model.sidebarWidth}px` }}>
      <div id="style-manager-host"/>
      <header class="navigation">
        {model.browser.automation?.enabled ? <Button variant="ghost" class="automation-stop" aria-label="Disable AI browser access" title={`AI access to all windows · ${model.browser.automation.clients} connections\n${model.browser.automation.endpoint}`} onClick={() => controller.send({ type: 'automation.set-enabled', enabled: false })}>AI · Stop</Button> : null}
        <Button variant="ghost" size="icon" aria-label="Back" title="Back (Alt+Left)" disabled={!active?.canGoBack} onClick={() => tabCommand('tab.back')}><ArrowLeft size={17}/></Button>
        <Button variant="ghost" size="icon" aria-label="Forward" title="Forward (Alt+Right)" disabled={!active?.canGoForward} onClick={() => tabCommand('tab.forward')}><ArrowRight size={17}/></Button>
        <Button variant="ghost" size="icon" aria-label={active?.loading ? 'Stop' : 'Reload'} title={active?.loading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)'} disabled={!active} onClick={() => tabCommand(active?.loading ? 'tab.stop' : 'tab.reload')}>{active?.loading ? <X size={17}/> : <RotateCw size={17}/>}</Button>
        <form class="address" hidden={compact} onSubmit={event => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem('location') as HTMLInputElement;
          controller.navigate(addressSuggestions[model.addressSelection]?.text ?? input.value);
        }}>
          <Button type="button" variant="ghost" size="icon" class="site-settings" aria-label="Site settings" title="Site permissions and security" disabled={!active || !/^https?:/.test(active.url)} onClick={() => tabCommand('tab.site-settings')}><SlidersHorizontal size={15}/></Button>
          <input id="location" name="location" aria-label="Address or search" placeholder="Search or enter address" value={model.addressInput ?? (active?.url === 'about:blank' ? '' : active?.url ?? '')} onFocus={event => controller.focusAddress(event.currentTarget.value)} onInput={event => controller.editAddress(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controller.selectAddress(event.key === 'ArrowDown' ? 1 : -1); } if (event.key === 'Escape') { event.preventDefault(); controller.dismissAddress(); } }} role="combobox" aria-expanded={addressSuggestions.length > 0} aria-controls="address-suggestions" aria-activedescendant={model.addressSelection >= 0 ? `address-option-${model.addressSelection}` : undefined} autocomplete="off" spellcheck={false}/>
          {!compact && addressSuggestions.length ? <ShellPopover side={bottomAddress ? 'top' : 'bottom'} class="address-suggestions" aria-label="Address suggestions" initialFocus={false} trigger={() => document.getElementById('location')} onDismiss={reason => reason === 'escape-key' ? controller.dismissAddress() : controller.blurAddress()}><div id="address-suggestions" role="listbox">{list(addressSuggestions, item => item.text, (item, index) => <button type="button" role="option" id={`address-option-${index}`} aria-selected={model.addressSelection === index} onPointerDown={event => event.preventDefault()} onClick={() => controller.navigate(item.text)}><span class="suggestion-icon" aria-hidden="true">{item.favicon ? <img class="suggestion-favicon" src={item.favicon} alt=""/> : item.source === 'history' ? <History size={16}/> : item.source === 'bookmark' ? <Bookmark size={16}/> : item.source === 'settings' ? <SlidersHorizontal size={16}/> : item.source === 'search' ? <Search size={16}/> : <Globe size={16}/>}</span><span class="suggestion-copy"><strong>{item.title}</strong><small>{suggestionDetails(item)}</small></span><span class="suggestion-enter" aria-hidden="true">↵</span></button>)}</div></ShellPopover> : null}
        </form>
        {model.browser.credentialProposal && openCredentials ? <Button variant="ghost" class="credential-suggestion" title={`Password for ${model.browser.credentialProposal.origin}`} onClick={() => openCredentials(model.browser.credentialProposal!)}>Save password?</Button> : null}
        {(['styles', 'scripts'] as const).map(kind => {
          const matches = model.pageSources && model.pageSources.tabId === active?.id && model.pageSources.url === active?.url ? model.pageSources[kind] : [];
          const count = matches.filter(item => item.enabled).length;
          return <Button variant="ghost" size="icon" class="page-sources-button" aria-label={kind === 'styles' ? 'Styles on this page' : 'Scripts on this page'} aria-haspopup="dialog" title={`${kind === 'styles' ? 'Styles' : 'Scripts'} · ${count} enabled on this page`} disabled={!model.connected || !openPageSources || !active || !!active.private} onClick={() => { controller.setPanel(null); openPageSources?.(kind); }}>{kind === 'styles' ? <Palette size={17}/> : <CodeXml size={17}/>}<span class="source-count" hidden={!count}>{count}</span></Button>;
        })}
        <Button variant="ghost" size="icon" class="proxy-switcher-button" aria-label="Proxy switcher" aria-haspopup="dialog" title={`Proxy · ${model.browser.proxyProfile === 'direct' ? 'Direct connection' : model.browser.proxyProfile === 'system' || !model.browser.proxyProfile ? 'System proxy' : model.browser.proxyProfile}`} disabled={!model.connected || !openProxy || !!active?.private} onClick={() => { controller.setPanel(null); openProxy?.(); }}><Globe size={17}/>{model.browser.proxyProfile && !['direct', 'system'].includes(model.browser.proxyProfile) ? <span class="proxy-active-dot"/> : null}</Button>
        <Button variant="ghost" size="icon" aria-label="Menu" aria-controls="browser-menu-popup" aria-expanded={model.panel === 'menu'} onClick={() => controller.setPanel(model.panel ? null : 'menu')}><Menu size={17}/></Button>
        {compact ? <button class="compact-address" id="compact-location" aria-label="Open address palette" title={active?.url || 'Search or enter address'} onClick={() => controller.openAddressPalette()}><Globe size={15}/><span>{active?.url && active.url !== 'about:blank' ? active.url.replace(/^https?:\/\//, '').split('/')[0] : 'Search or enter address'}</span><kbd>Ctrl L</kbd></button> : null}
      </header>
      <aside class="tabs" aria-label="Tabs">
        <div class="tab-list" role="tablist" aria-orientation={model.layout}>
          {units.some(unit => unit.tabs.every(tab => tab.pinned)) ? <div class="pinned-tabs">{list(units.filter(unit => unit.tabs.every(tab => tab.pinned)), unit => unit.id, renderTabUnit)}</div> : null}
          {list(units.filter(unit => !unit.tabs.every(tab => tab.pinned)), unit => unit.id, renderTabUnit)}
        </div>
        <Button variant="ghost" class="new-tab" title="New tab (Ctrl+T)" aria-label="New tab" disabled={!model.connected} onClick={() => controller.send({ type: 'tab.create', private: active?.private ?? false })}><Plus size={16}/><span class="new-tab-label">New tab</span></Button>
        {workspaceControls(model,controller)}
      </aside>
      <div id="sidebar-resize" role="separator" aria-label="Resize tab sidebar" aria-orientation="vertical" aria-valuemin={120} aria-valuemax={600} aria-valuenow={model.sidebarResizeWidth ?? model.sidebarWidth} tabindex={model.layout === 'vertical' ? 0 : -1} title="Drag to resize · double-click to reset"/>
      <section id="content-surface" class="content-surface" aria-label="Page">
        {activeSplit ? <div class={`split-divider ${activeSplit.axis}`} role="separator" aria-label="Resize split" aria-orientation={activeSplit.axis === 'horizontal' ? 'vertical' : 'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(activeSplit.ratio * 100)} tabindex={0} style={{ '--split-ratio': activeSplit.ratio }} data-tab-id={activeSplit.firstTabId}/> : null}
        <div class="split-drag-surface" hidden={true}/>
        {!model.connected ? <div class="welcome"><div class="mark">d<span>b</span></div><h1>New tab</h1><p>Open the desktop browser.</p><p class="subtle">Browser connection unavailable.</p></div> : null}
      </section>
      {workspaceEditor(model,controller)}
      {compact && model.addressPaletteOpen ? AddressPalette({ model, controller }) : null}
      {login && autofill ? <ShellMenu class="credential-autofill" aria-label="Saved logins" initialFocus={false} anchor={{ getBoundingClientRect: () => new DOMRect(login.x, login.y, 280, 0) }} onDismiss={() => autofill(login.token)}>
        <header><span>Saved logins</span></header>
        <div class="credential-autofill-items">{list(login.items, entry => entry.id, entry => <Button variant="ghost" role="menuitem" data-credential-id={entry.id} onClick={() => autofill(login.token, entry.id)}>{entry.username || 'No username'}</Button>)}</div>
        <small>{login.origin}</small>
      </ShellMenu> : null}
      {model.tabMenu && contextTab ? <ShellMenu class="tab-menu" aria-label="Tab actions" initialFocus="surface" trigger={() => Array.from(document.querySelectorAll<HTMLElement>('[role=tab]')).find(tab => tab.dataset.tabId === contextTab.id)} anchor={{ getBoundingClientRect: () => new DOMRect(model.tabMenu!.x, model.tabMenu!.y, 0, 0) }} onDismiss={() => controller.closeTabMenu()}>
        {contextSplit ? <Button variant="ghost" role="menuitem" onClick={() => { controller.closeTabMenu(); controller.send({ type: 'split.switch', tabId: contextTab.id }); }}>{contextSplit.axis === 'horizontal' ? 'Switch to top and bottom' : 'Switch to side by side'}</Button> : null}
        {contextTab.parentId || parents.has(contextTab.id) ? <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('ungroup')}>{contextTab.parentId ? 'Move out of group' : 'Ungroup tabs'}</Button> : null}
        {contextSplit || contextTab.parentId || parents.has(contextTab.id) ? <hr/> : null}
        <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('duplicate')}>Duplicate tab</Button>
        <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('pin')}>{contextTab.pinned ? 'Unpin tab' : 'Pin tab'}</Button>
        <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('mute')}>{contextTab.muted ? 'Unmute' : 'Mute'}</Button>
        <hr/>
        <Button variant="ghost" role="menuitem" disabled={contextSiblingIndex <= 0} onClick={() => controller.tabMenuAction('previous')}>{model.layout === 'vertical' ? 'Move up' : 'Move left'}</Button>
        <Button variant="ghost" role="menuitem" disabled={contextSiblingIndex >= contextSiblings.length - 1} onClick={() => controller.tabMenuAction('next')}>{model.layout === 'vertical' ? 'Move down' : 'Move right'}</Button>
        <hr/>
        <Button variant="ghost" role="menuitem" disabled={!model.browser.tabs.some(tab => tab.id !== contextTab.id && !tab.pinned)} onClick={() => controller.tabMenuAction('close-others')}>Close other tabs</Button>
        <Button variant="ghost" role="menuitem" disabled={!model.browser.tabs.slice(contextIndex + 1).some(tab => !tab.pinned)} onClick={() => controller.tabMenuAction('close-right')}>{model.layout === 'vertical' ? 'Close tabs below' : 'Close tabs to the right'}</Button>
        <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('close')}>{parents.has(contextTab.id) ? 'Close tab · keep children' : 'Close tab'}</Button>
        {parents.has(contextTab.id) ? <Button variant="ghost" role="menuitem" onClick={() => controller.tabMenuAction('close-group')}>Close entire group ({1 + model.browser.tabs.filter(tab => tab.parentId === contextTab.id).length})</Button> : null}
      </ShellMenu> : null}
      {model.panel === 'menu' ? <ShellMenu id="browser-menu" class="browser-menu" aria-label="Browser menu" trigger={() => document.querySelector('button[aria-label="Menu"]')} onDismiss={() => controller.setPanel(null)} onKeyDown={event => {
        if(event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
        const command=model.browser.scriptCommands?.find(command=>command.accessKey && command.accessKey.toLocaleLowerCase()===event.key.toLocaleLowerCase());
        if(command){event.preventDefault();controller.executeScriptCommand(command,event);}
      }}>
        <Button role="menuitem" variant="ghost" aria-label="New window" disabled={!model.connected} onClick={() => { controller.send({ type: 'window.new', private: false }); controller.setPanel(null); }}>New window <kbd>Ctrl N</kbd></Button>
        <Button role="menuitem" variant="ghost" aria-label="Private window" disabled={!model.connected} onClick={() => { controller.send({ type: 'window.new', private: true }); controller.setPanel(null); }}>Private window <kbd>Ctrl Shift N</kbd></Button>
        <Button role="menuitem" variant="ghost" disabled={!model.connected} onClick={() => { controller.send({ type: 'tab.reopen' }); controller.setPanel(null); }}>Reopen closed tab <kbd>Ctrl Shift T</kbd></Button>
        {model.browser.workspaces ? <Button role="menuitem" variant="ghost" aria-label="New workspace" onClick={() => { controller.setPanel(null); controller.openWorkspaceEditor(); }}>New workspace</Button> : null}
        <hr/>
        <div class="zoom-controls" role="group" aria-label="Page zoom">
          <Button role="menuitem" variant="ghost" disabled={!active} aria-label="Zoom out" onClick={() => tabCommand('tab.zoom-out')}>−</Button>
          <Button role="menuitem" variant="ghost" disabled={!active} title="Reset zoom" onClick={() => tabCommand('tab.zoom-reset')}>{Math.round((active?.zoom ?? 1) * 100)}%</Button>
          <Button role="menuitem" variant="ghost" disabled={!active} aria-label="Zoom in" onClick={() => tabCommand('tab.zoom-in')}>+</Button>
        </div>
        <Button role="menuitem" variant="ghost" disabled={!active} onClick={() => { controller.setPanel(null); tabCommand('tab.find'); }}>Find in page <kbd>Ctrl F</kbd></Button>
        <Button role="menuitem" variant="ghost" disabled={!active} onClick={() => { controller.setPanel(null); tabCommand('tab.bookmark'); }}>Bookmark page <kbd>Ctrl D</kbd></Button>
        <Button role="menuitem" variant="ghost" aria-label="Inspect" disabled={!active || !model.connected} onClick={() => { controller.setPanel(null); tabCommand('tab.inspect'); }}>Inspect <kbd>F12</kbd></Button>
        {model.browser.automation ? <Button role="menuitem" variant="ghost" aria-label={model.browser.automation.enabled ? 'Disable AI browser access' : 'Enable AI browser access'} disabled={!model.connected} onClick={() => { controller.send({ type: 'automation.set-enabled', enabled: !model.browser.automation?.enabled }); controller.setPanel(null); }}>{model.browser.automation.enabled ? 'Disable AI access' : 'Allow AI access to all windows'} <kbd>Ctrl Alt A</kbd></Button> : null}
        <details class="menu-tools"><summary role="menuitem">Content blocking</summary>
        <Button role="menuitem" variant="ghost" disabled={!active || !!active.private} onClick={() => { if (active) { controller.setPanel(null); controller.send({ type: 'blocking.pick', tabId: active.id }); } }}>Block element…</Button>
        <Button role="menuitem" variant="ghost" disabled={!active} onClick={() => { if (active) { controller.setPanel(null); controller.send({ type: 'blocking.zap', tabId: active.id }); } }}>Hide element until reload…</Button>
        <Button role="menuitem" variant="ghost" disabled={!model.connected || !active} onClick={() => controller.setPanel('blocking')}>Request log</Button>
        </details>
        {model.browser.scriptCommands?.length ? <details class="script-command-menu">
          <summary role="menuitem">Script commands <span>{model.browser.scriptCommands.length}</span></summary>
          <div>{list(model.browser.scriptCommands,command=>command.id,command=><Button role="menuitem" variant="ghost" title={command.title || command.script} onClick={event=>controller.executeScriptCommand(command,event)}>
            <span><strong>{command.label}</strong><small>{command.script}</small></span>{command.accessKey?<kbd>{command.accessKey}</kbd>:null}
          </Button>)}</div>
        </details> : null}
        <hr/>
        <Button role="menuitem" variant="ghost" aria-label="History" disabled={!model.connected} onClick={() => controller.openPage('history')}>History <kbd>Ctrl H</kbd></Button>
        <Button role="menuitem" variant="ghost" aria-label="Downloads" disabled={!model.connected} onClick={() => controller.openPage('downloads')}>Downloads <kbd>Ctrl J</kbd></Button>
        <Button role="menuitem" variant="ghost" aria-label="Bookmarks" disabled={!model.connected} onClick={() => controller.openPage('bookmarks')}>Bookmarks</Button>
        <Button role="menuitem" variant="ghost" disabled={!model.connected || !openImport || !!active?.private} onClick={() => { controller.setPanel(null); openImport?.(); }}>Import browser data</Button>
        <Button role="menuitem" variant="ghost" aria-label="Passwords" disabled={!model.connected || !openCredentials || !!active?.private} onClick={() => { controller.setPanel(null); openCredentials?.(); }}>Passwords</Button>
        <Button role="menuitem" variant="ghost" aria-label="User styles" disabled={!model.connected || !openStyles || !!active?.private} onClick={() => { controller.setPanel(null); openStyles?.(); }}>User styles</Button>
        <Button role="menuitem" variant="ghost" aria-label="Userscripts" disabled={!model.connected || !openScripts || !!active?.private} onClick={() => { controller.setPanel(null); openScripts?.(); }}>Userscripts</Button>
        <Button role="menuitem" variant="ghost" aria-label="Settings" disabled={!model.connected} onClick={() => controller.openPage('settings')}>Settings</Button>
        <hr/>
        <Button role="menuitem" variant="ghost" onClick={() => controller.setLayout(model.layout === 'vertical' ? 'horizontal' : 'vertical')}>{model.layout === 'vertical' ? 'Horizontal tabs' : 'Vertical tabs'}</Button>
        {model.layout === 'horizontal' ? <Button role="menuitem" variant="ghost" aria-pressed={model.wrapTabs} onClick={() => controller.setWrapTabs(!model.wrapTabs)}>Wrap tabs into rows <span>{model.wrapTabs ? 'On' : 'Off'}</span></Button> : null}
      </ShellMenu> : null}
      {model.panel === 'blocking' ? <ShellDialog class="blocking-log" aria-label="Request log" onDismiss={() => controller.setPanel(null)} trigger={() => document.querySelector('button[aria-label="Menu"]')}>
        <header><div><h2>Request log</h2><p>{active?.title || 'Active tab'}{active?.private ? ' · Private' : ''}</p></div><Button variant="ghost" size="icon" aria-label="Close log" onClick={() => controller.setPanel(null)}><X size={17}/></Button></header>
        <details class="dynamic-rules"><summary>Dynamic rules</summary>
          <p>Format: source destination type action. Example: <code>* * 3p-script block</code>. Types: *, image, inline-script, 1p-script, 3p-script, 3p-frame, 3p. Actions: block, allow, noop. Changes apply to new requests.</p>
          <form onSubmit={event => { event.preventDefault(); controller.send({ type: 'blocking.dynamic-save', rules: (event.currentTarget.elements.namedItem('rules') as HTMLTextAreaElement).value }); }}>
            <textarea name="rules" aria-label="Dynamic rules" value={model.dynamicDraft ?? model.browser.dynamicRules ?? ''} onInput={event => controller.setDynamicDraft(event.currentTarget.value)} maxLength={65536} spellcheck={false}/>
            <Button type="submit" disabled={!!active?.private}>Save rules</Button>
          </form>
        </details>
        <div class="blocking-log-tools"><input aria-label="Search requests" placeholder="URL, request type or rule" value={model.blockingSearch} onInput={event => controller.setBlockingSearch(event.currentTarget.value)}/><Button variant="ghost" onClick={() => controller.updateBlockingLog()}>Reload</Button><Button variant="ghost" onClick={() => controller.updateBlockingLog(true)}>Clear</Button></div>
        <p class="blocking-log-hint">Last 128 events. Refresh to update.</p>
        <div class="blocking-log-rows">{blocked.length ? list(blocked, row => `${log?.tabId}:${row.id}`, row => <div class="blocking-log-row"><span>{row.kind}</span><div class="blocking-log-detail"><code title={row.url}>{row.url}</code>{row.rule ? <details><summary>Matched rule</summary><code>{row.rule}</code></details> : <small>{row.kind.startsWith('Request ·') ? 'Resource request' : 'No rule provided'}</small>}</div></div>) : <p class="blocking-log-empty">{query ? 'No matches' : 'No entries. Refresh after the page loads.'}</p>}</div>
      </ShellDialog> : null}
      {model.browser.filterProposal ? <ShellDialog class="blocking-log filter-picker" aria-label="Block element" onDismiss={() => controller.send({ type: 'blocking.picker-cancel', tabId: model.browser.filterProposal!.tabId })}>
        <h2>Block element</h2><p>Applies to this site. Edit it in blocker settings.</p>
        <form onSubmit={event => { event.preventDefault(); const rule = (event.currentTarget.elements.namedItem('rule') as HTMLInputElement).value; controller.send({ type: 'blocking.picker-save', tabId: model.browser.filterProposal!.tabId, rule }); }}>
          <input name="rule" aria-label="Element rule" value={model.browser.filterProposal.rule} maxLength={8192}/>
          <Button type="submit">Save rule</Button><Button type="button" variant="ghost" onClick={() => controller.send({ type: 'blocking.picker-cancel', tabId: model.browser.filterProposal!.tabId })}>Cancel</Button>
        </form>
      </ShellDialog> : null}
      {model.error ? <div class="error" role="alert"><span>{model.error}</span><button aria-label="Dismiss notification" onClick={controller.dismissError}><X size={15}/></button></div> : null}
    </main>;
  });
}
