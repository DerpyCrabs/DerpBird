import { focusShellElement } from '../browser/shell-interaction';
import { ShellMenu, ShellDialog } from './Overlay';
import { Effect } from 'effect';
import { mount, modelOwner, view } from 'effectweb';
import Network from '@effectweb/lucide/icons/network';
import Globe from '@effectweb/lucide/icons/globe';
import Monitor from '@effectweb/lucide/icons/monitor';
import Check from '@effectweb/lucide/icons/check';
import Plus from '@effectweb/lucide/icons/plus';
import X from '@effectweb/lucide/icons/x';
import Upload from '@effectweb/lucide/icons/upload';
import Download from '@effectweb/lucide/icons/download';
import Settings from '@effectweb/lucide/icons/settings-2';
import ArrowUp from '@effectweb/lucide/icons/arrow-up';
import ArrowDown from '@effectweb/lucide/icons/arrow-down';
import Trash from '@effectweb/lucide/icons/trash-2';
import { exportSource } from '../browser/source-files';
import { conditionTypes, decodeProxySnapshot, exportProxyBackup, importProxyBackup, proxyProfiles, type ProxyEndpoint, type ProxyOptions, type ProxyPort, type ProxyProfile, type ProxyRule, type ProxySnapshot } from '../browser/proxy-protocol';
interface Model { settings: boolean; creating: boolean; snapshot: ProxySnapshot | null; options: ProxyOptions; active: string; selected: string; busy: boolean; dirty: boolean; error: string; message: string; search: string; page: number; newName: string; newType: string; discard: boolean }
export function openProxyManager(host: HTMLElement, port: ProxyPort, onClosed: () => void, currentURL = '') {
  let state: Model = { settings: false, creating: false, snapshot: null, options: { schemaVersion: 2 }, active: 'system', selected: '', busy: false, dirty: false, error: '', message: '', search: '', page: 0, newName: '', newType: 'FixedProfile', discard: false };
  const owner = modelOwner(state);
  let disposed = false;
  const patch = (change: Partial<Model>) => { if (!disposed) { state = { ...state, ...change }; owner.patch(change); } };
  const run = (work: () => Promise<void>) => {
    if (state.busy || disposed) return;
    patch({ busy: true, error: '', message: '' });
    owner.run(['proxy'], Effect.tryPromise({ try: async () => { try { await work(); } finally { patch({ busy: false }); } }, catch: error => error })
      .pipe(Effect.catch(error => Effect.sync(() => patch({ error: error instanceof Error ? error.message : String(error) })))), 'queue');
  };
  const accept = (snapshot: ProxySnapshot) => patch({ snapshot, options: structuredClone(snapshot.options), active: snapshot.active, dirty: false, selected: snapshot.options[`+${state.selected}`] ? state.selected : proxyProfiles(snapshot.options)[0]?.name ?? '', discard: false });
  const save = (active = state.active) => run(async () => { accept(await port.replace(decodeProxySnapshot({ revision: state.snapshot!.revision, active, options: state.options }))); patch({ message: 'Proxy settings applied. Reload existing pages to reconnect.' }); });
  const change = (profile: ProxyProfile) => patch({ options: { ...state.options, [`+${profile.name}`]: { ...profile, revision: new Date().toISOString() } }, dirty: true, error: '', message: '', discard: false });
  const selected = () => state.options[`+${state.selected}`] as ProxyProfile;
  const editRule = (index: number, rule: ProxyRule | null, offset = 0) => {
    const profile = selected(), rules = [...(profile.rules ?? [])];
    if (offset) { const other = index + offset; [rules[index], rules[other]] = [rules[other], rules[index]]; }
    else if (rule) rules[index] = rule;
    else rules.splice(index, 1);
    change({ ...profile, rules });
  };
  const addProfile = () => {
    const name = state.newName.trim();
    if (!name || name === 'direct' || name === 'system' || state.options[`+${name}`]) { patch({ error: 'Choose a unique profile name.' }); return; }
    const profile: ProxyProfile = { name, profileType: state.newType, color: '#6b94c4', ...(state.newType === 'FixedProfile' ? { fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 8080 }, bypassList: [{ conditionType: 'BypassCondition', pattern: '<local>' }] } : { defaultProfileName: 'direct', rules: [] }) };
    change(profile); patch({ selected: name, newName: '', page: 0, search: '', creating: false });
  };
  const removeProfile = () => {
    const name = state.selected;
    if (proxyProfiles(state.options).some(p => p.name !== name && (p.defaultProfileName === name || p.rules?.some(r => r.profileName === name)))) { patch({ error: 'This profile is used by a rule or default. Change those references before deleting it.' }); return; }
    const options = { ...state.options }; delete options[`+${name}`];
    if (options['-startupProfileName'] === name) options['-startupProfileName'] = 'direct';
    if (Array.isArray(options['-quickSwitchProfiles'])) options['-quickSwitchProfiles'] = options['-quickSwitchProfiles'].filter(p => p !== name);
    patch({ options, selected: proxyProfiles(options)[0]?.name ?? '', active: state.active === name ? 'direct' : state.active, dirty: true, error: '' });
  };
  const importFile = (file: File) => run(async () => {
    if (file.size > 16 * 1024 * 1024) throw new Error('Proxy backup exceeds 16 MiB.');
    const options = importProxyBackup(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    const profiles = proxyProfiles(options), startup = options['-startupProfileName'];
    const active = typeof startup === 'string' && (['direct', 'system'].includes(startup) || options[`+${startup}`]) ? startup : profiles.find(p => p.profileType === 'SwitchProfile')?.name ?? 'direct';
    patch({ creating: false, options, active, selected: profiles[0]?.name ?? '', dirty: true, search: '', page: 0, message: `Imported ${profiles.length} profiles and ${profiles.reduce((sum, p) => sum + (p.rules?.length ?? 0), 0)} rules. Review and apply to replace your settings.` });
  });
  const close = () => { if (state.busy) return; if (state.dirty) { patch({ discard: true }); return; } dispose(); onClosed(); };
  const choices = (options: ProxyOptions) => [<option value="direct">Direct connection</option>, <option value="system">System proxy</option>, ...proxyProfiles(options).map(p => <option value={p.name}>{p.name}</option>)];
  const displayName = (name: string) => name === 'direct' ? 'Direct connection' : name === 'system' ? 'System proxy' : name;
  const profileDetail = (profile: ProxyProfile) => profile.profileType === 'SwitchProfile' || profile.profileType === 'VirtualProfile' ? `${profile.rules?.length ?? 0} rules` : profile.fallbackProxy?.host ? `${profile.fallbackProxy.host}:${profile.fallbackProxy.port}` : profile.profileType === 'DirectProfile' ? 'Direct connection' : 'Proxy server';
  const color = (profile?: ProxyProfile) => profile?.color && /^#[0-9a-f]{3,8}$/i.test(profile.color) ? profile.color : '#9cbaad';
  const labels: Record<string, string> = { HostWildcardCondition: 'Domain', UrlWildcardCondition: 'URL pattern', HostRegexCondition: 'Domain regex', UrlRegexCondition: 'URL regex', KeywordCondition: 'Keyword', BypassCondition: 'Bypass', IpCondition: 'IP range', TrueCondition: 'Always', FalseCondition: 'Disabled' };
  const focusFirst = () => window.requestAnimationFrame(() => {
    if (!disposed) focusShellElement(state.settings ? host.querySelector<HTMLElement>('[aria-label="Close proxy settings"]') : host.querySelector<HTMLElement>('[aria-pressed="true"]') ?? host.querySelector<HTMLElement>('.proxy-profile-option'));
  });
  const openSettings = () => { patch({ settings: true }); focusFirst(); };
  const choose = (active: string) => run(async () => {
    if (active !== state.snapshot!.active) await port.replace({ ...state.snapshot!, active });
    dispose(); onClosed();
  });
  const pickFile = () => host.querySelector<HTMLInputElement>('[type=file]')?.click();
  const importButton = (primary = false) => <button class={primary ? 'proxy-button primary' : 'proxy-button'} disabled={state.busy || !state.snapshot || state.dirty} onClick={pickFile}><Upload size={15}/>Import backup</button>;
  const endpoint = (profile: ProxyProfile, field: 'fallbackProxy' | 'proxyForHttp' | 'proxyForHttps', label: string) => {
    const server = profile[field];
    const update = (value: ProxyEndpoint | undefined) => { const next = { ...profile }; if (value) next[field] = value; else delete next[field]; change(next); };
    return <div class="proxy-endpoint"><label>{label}<select aria-label={`${label} protocol`} value={server?.scheme ?? ''} onChange={e => update(e.currentTarget.value ? { scheme: e.currentTarget.value, host: server?.host ?? '127.0.0.1', port: server?.port ?? 8080 } : undefined)}>
      <option value="">{field === 'fallbackProxy' ? 'Direct connection' : 'Use fallback proxy'}</option><option value="direct">Direct connection</option><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option>
    </select></label>{server && server.scheme !== 'direct' ? <><label>Server<input aria-label={`${label} host`} value={server.host ?? ''} placeholder="127.0.0.1" spellcheck={false} onInput={e => update({ ...server, host: e.currentTarget.value })}/></label><label>Port<input aria-label={`${label} port`} type="number" min={1} max={65535} value={server.port ?? 8080} onInput={e => update({ ...server, port: Number(e.currentTarget.value) })}/></label></> : null}</div>;
  };
  const authentication = (profile: ProxyProfile, key: string, label: string) => {
    const auth = (profile.auth ?? {}) as Record<string, { username?: string; password?: string }>;
    const value = auth[key] ?? {};
    const update = (field: 'username' | 'password', text: string) => {
      const next = { ...auth, [key]: { username: value.username ?? '', password: value.password ?? '', [field]: text } };
      if (!next[key].username && !next[key].password) delete next[key];
      change({ ...profile, auth: next });
    };
    return <div class="proxy-auth-row"><span>{label}</span><label>Username<input aria-label={`${label} username`} value={value.username ?? ''} autocomplete="off" onInput={e => update('username', e.currentTarget.value)}/></label><label>Password<input type="password" aria-label={`${label} password`} value={value.password ?? ''} autocomplete="off" onInput={e => update('password', e.currentTarget.value)}/></label></div>;
  };
  const render = view<Model>(m => {
    const profiles = proxyProfiles(m.options), profile = profiles.find(p => p.name === m.selected);
    if (!m.settings) {
      const anchor = document.querySelector('[aria-label="Proxy switcher"]')?.getBoundingClientRect();
      const top = (anchor?.bottom ?? 36) + 6;
      return <ShellMenu onDismiss={close} trigger={() => document.querySelector('button[aria-label="Proxy switcher"]')} class="style-manager proxy-popup" style={{ maxHeight: `calc(100vh - ${top + 8}px)` }} aria-label="Proxy profiles">
        <div class="proxy-popup-heading"><strong>Proxy</strong>{m.busy ? <span>{m.snapshot ? 'Switching…' : 'Loading…'}</span> : null}</div>
        <div class="proxy-profile-list">
          <button role="menuitemradio" class="proxy-profile-option" aria-pressed={m.active === 'direct'} disabled={m.busy || !m.snapshot} onClick={() => choose('direct')}><Globe size={17}/><span><strong>Direct connection</strong></span>{m.active === 'direct' ? <Check size={16}/> : null}</button>
          <button role="menuitemradio" class="proxy-profile-option" aria-pressed={m.active === 'system'} disabled={m.busy || !m.snapshot} onClick={() => choose('system')}><Monitor size={17}/><span><strong>System proxy</strong></span>{m.active === 'system' ? <Check size={16}/> : null}</button>
          {profiles.length ? <div class="proxy-popup-divider"/> : null}
          {profiles.map(p => <button role="menuitemradio" class="proxy-profile-option" title={p.name} aria-pressed={m.active === p.name} disabled={m.busy} onClick={() => choose(p.name)}><span class="proxy-color" style={{ backgroundColor: color(p) }}/><span><strong>{p.name}</strong><small>{profileDetail(p)}</small></span>{m.active === p.name ? <Check size={16}/> : null}</button>)}
        </div>

        {m.error ? <p role="alert">{m.error}</p> : null}
        <button role="menuitem" class="proxy-popup-settings" disabled={m.busy} onClick={openSettings}><Settings size={16}/><span>Proxy settings</span></button>
      </ShellMenu>;
    }
    const rules = (profile?.rules ?? []).map((rule, index) => ({ rule, index })).filter(({ rule }) => `${rule.condition.pattern ?? rule.condition.ip ?? ''} ${rule.profileName}`.toLowerCase().includes(m.search.toLowerCase()));
    const page = Math.min(m.page, Math.max(0, Math.ceil(rules.length / 40) - 1));
    const hasEditor = profiles.length > 0 || m.creating;
    return <ShellDialog onDismiss={close} trigger={() => document.querySelector('button[aria-label="Proxy switcher"]')} class={`style-manager proxy-manager ${hasEditor ? 'has-profiles' : 'is-empty'}`} aria-label="Proxy settings" tabindex={-1}>
      <header class="proxy-settings-header"><div><h2>Proxy settings</h2></div><button class="proxy-icon-button" aria-label="Close proxy settings" disabled={m.busy} onClick={close}><X size={18}/></button></header>
      <input hidden type="file" aria-label="Import ZeroOmega backup" accept=".bak,.json" disabled={m.busy || !m.snapshot || m.dirty} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) importFile(file); e.currentTarget.value = ''; }}/>
      {hasEditor ? <div class="proxy-settings-toolbar"><label>Active profile<select aria-label="Active proxy profile" disabled={m.busy || !m.snapshot} value={m.active} onChange={e => { const active = e.currentTarget.value; if (m.dirty) patch({ active }); else save(active); }}>{choices(m.options)}</select></label><div class="proxy-backup-actions">{importButton()}<button class="proxy-button" disabled={m.busy || !m.snapshot} onClick={() => { try { exportSource('ZeroOmegaOptions', exportProxyBackup(m.options), '.bak'); } catch (error) { patch({ error: String(error) }); } }}><Download size={15}/>Export backup</button></div></div> : null}
      {m.error ? <p class="proxy-notice error-notice" role="alert">{m.error}</p> : null}{m.message ? <p class="proxy-notice" role="status">{m.message}</p> : null}
      {!hasEditor ? <div class="proxy-empty"><div class="proxy-empty-icon"><Network size={28}/></div><h3>No proxy profiles</h3><div class="proxy-actions">{importButton(true)}<button class="proxy-button" disabled={m.busy || !m.snapshot} onClick={() => patch({ creating: true })}><Plus size={15}/>New profile</button></div><small>ZeroOmega and SwitchyOmega backups (.bak, .json)</small></div> : <div class="proxy-settings-body">
        <aside aria-label="Proxy profiles"><div class="proxy-sidebar-heading">Profiles <span>{profiles.length}</span></div><div class="proxy-sidebar-list">{profiles.map(p => <button class="proxy-sidebar-profile" title={p.name} aria-pressed={!m.creating && p.name === m.selected} disabled={m.busy} onClick={() => patch({ creating: false, selected: p.name, search: '', page: 0 })}><span class="proxy-color" style={{ backgroundColor: color(p) }}/><span><strong>{p.name}</strong><small>{profileDetail(p)}</small></span></button>)}</div><button class="proxy-new-profile" disabled={m.busy || !m.snapshot} onClick={() => patch({ creating: true, newName: '', error: '' })}><Plus size={15}/>New profile</button></aside>
        <main class={`proxy-editor ${!m.creating && ['SwitchProfile', 'VirtualProfile'].includes(profile?.profileType ?? '') ? 'is-rules' : ''}`}><fieldset disabled={m.busy || !m.snapshot}>
          {m.creating ? <div class="proxy-create"><h3>New profile</h3><label>Profile name<input aria-label="New proxy profile name" placeholder="e.g. Work proxy" value={m.newName} onInput={e => patch({ newName: e.currentTarget.value })} onKeyDown={e => { if (e.key === 'Enter' && m.newName.trim()) { e.preventDefault(); addProfile(); } }}/></label><label>Profile type<select aria-label="New proxy profile type" value={m.newType} onChange={e => patch({ newType: e.currentTarget.value })}><option value="FixedProfile">Proxy server</option><option value="SwitchProfile">Automatic rules</option></select></label><div class="proxy-actions"><button class="proxy-button primary" disabled={!m.newName.trim()} onClick={addProfile}>Create profile</button><button class="proxy-button" onClick={() => patch({ creating: false })}>Cancel</button></div></div> : profile ? <>
            <div class="proxy-editor-heading"><div><h3>{profile.name}</h3><p>{profile.profileType === 'FixedProfile' ? 'Proxy server' : 'Automatic rules'}</p></div><button class="proxy-icon-button" aria-label="Delete profile" title="Delete profile" onClick={removeProfile}><Trash size={16}/></button></div>
            {profile.profileType === 'FixedProfile' ? <div class="proxy-server-form">{endpoint(profile, 'fallbackProxy', 'Fallback proxy')}<details class="proxy-detail"><summary>Different proxies for HTTP and HTTPS</summary><div>{endpoint(profile, 'proxyForHttp', 'HTTP websites')}{endpoint(profile, 'proxyForHttps', 'HTTPS websites')}</div></details>
              {(profile.proxyForHttp || profile.proxyForHttps) ? <p class="proxy-override-note">This profile has separate proxies for HTTP or HTTPS.</p> : null}
              <label>Bypass proxy for<textarea aria-label="Proxy bypass patterns" rows={4} placeholder={'localhost\n127.0.0.1\n*.local'} value={(profile.bypassList ?? []).map(c => c.pattern ?? '').join('\n')} onChange={e => change({ ...profile, bypassList: e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean).map(pattern => ({ conditionType: 'BypassCondition', pattern })) })}/><small>One hostname or IP range per line.</small></label>
              <details class="proxy-detail"><summary>Authentication</summary><div>{authentication(profile, 'all', 'All connections')}{['fallbackProxy', 'proxyForHttp', 'proxyForHttps'].filter(key => (profile.auth as Record<string, unknown> | undefined)?.[key]).map(key => authentication(profile, key, key === 'fallbackProxy' ? 'Fallback proxy' : key === 'proxyForHttp' ? 'HTTP websites' : 'HTTPS websites'))}</div></details>
            </div> : profile.profileType === 'SwitchProfile' || profile.profileType === 'VirtualProfile' ? <>
              <div class="proxy-rules-tools"><input type="search" aria-label="Search proxy rules" placeholder="Search domains or profiles…" value={m.search} onInput={e => patch({ search: e.currentTarget.value, page: 0 })}/><button class="proxy-button" onClick={() => { let pattern = ''; try { pattern = new URL(currentURL).hostname; } catch {} change({ ...profile, rules: [{ condition: { conditionType: 'HostWildcardCondition', pattern }, profileName: profiles.find(p => p.profileType === 'FixedProfile')?.name ?? 'direct' }, ...(profile.rules ?? [])] }); patch({ search: '', page: 0 }); }}><Plus size={15}/>Add rule</button></div>
              <p class="proxy-rules-help">First matching rule wins. *.example.com includes the domain itself.</p>
              <div class="proxy-rule-head"><span>#</span><span>Match</span><span>Pattern</span><span>Use profile</span><span/></div>
              <div class="proxy-rules">{rules.slice(page * 40, (page + 1) * 40).map(({ rule, index }) => <div class="proxy-rule" data-rule-index={index}>
                <span class="proxy-rule-number">{index + 1}</span><select aria-label={`Rule ${index + 1} condition`} value={rule.condition.conditionType} onChange={e => editRule(index, { ...rule, condition: { conditionType: e.currentTarget.value, pattern: rule.condition.pattern ?? '', ...(e.currentTarget.value === 'IpCondition' ? { ip: '127.0.0.1', prefixLength: 32 } : {}) } })}>{conditionTypes.map(type => <option value={type}>{labels[type]}</option>)}</select>
                {rule.condition.conditionType === 'IpCondition' ? <input aria-label={`Rule ${index + 1} pattern`} value={`${rule.condition.ip}/${rule.condition.prefixLength}`} onChange={e => { const [ip, prefix] = e.currentTarget.value.split('/'); editRule(index, { ...rule, condition: { ...rule.condition, ip, prefixLength: Number(prefix) } }); }}/> : <input aria-label={`Rule ${index + 1} pattern`} placeholder="*.example.com" spellcheck={false} disabled={['TrueCondition', 'FalseCondition'].includes(rule.condition.conditionType)} value={rule.condition.pattern ?? ''} onInput={e => editRule(index, { ...rule, condition: { ...rule.condition, pattern: e.currentTarget.value } })}/>}
                <select aria-label={`Rule ${index + 1} target`} value={rule.profileName} onChange={e => editRule(index, { ...rule, profileName: e.currentTarget.value })}>{choices(m.options)}</select>
                <div class="proxy-rule-actions"><button aria-label={`Move rule ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => editRule(index, rule, -1)}><ArrowUp size={13}/></button><button aria-label={`Move rule ${index + 1} down`} title="Move down" disabled={index === (profile.rules?.length ?? 0) - 1} onClick={() => editRule(index, rule, 1)}><ArrowDown size={13}/></button><button aria-label={`Delete rule ${index + 1}`} title="Delete rule" onClick={() => editRule(index, null)}><X size={13}/></button></div>
              </div>)}</div>
              {!rules.length ? <p class="proxy-no-rules">{m.search ? 'No matching rules.' : 'No rules yet. Add a website to choose how it connects.'}</p> : null}
              <div class="proxy-pagination"><span>{rules.length ? `${page * 40 + 1}–${Math.min((page + 1) * 40, rules.length)} of ${rules.length}` : '0 rules'}</span><button class="proxy-button" disabled={page === 0} onClick={() => patch({ page: page - 1 })}>Previous</button><button class="proxy-button" disabled={(page + 1) * 40 >= rules.length} onClick={() => patch({ page: page + 1 })}>Next</button></div>
              <label class="proxy-default-profile">When no rule matches<select aria-label="Default proxy profile" value={profile.defaultProfileName ?? 'direct'} onChange={e => change({ ...profile, defaultProfileName: e.currentTarget.value })}>{choices(m.options)}</select></label>
            </> : <p>{profile.profileType === 'DirectProfile' ? 'Connect directly.' : 'Use the system proxy configuration.'}</p>}
          </> : null}
        </fieldset></main></div>}
      {hasEditor || m.discard ? <footer class="proxy-settings-footer">{m.discard ? <><span>Discard unsaved changes?</span><button class="proxy-button" onClick={() => patch({ discard: false })}>Keep editing</button><button class="proxy-button primary" onClick={() => { dispose(); onClosed(); }}>Discard and close</button></> : <><span>{m.dirty ? 'Unsaved changes' : 'Applies to all browser windows.'}</span><button class="proxy-button" disabled={m.busy || !m.dirty} onClick={() => run(async () => accept(await port.get()))}>Discard changes</button><button class="proxy-button primary" disabled={m.busy || !m.snapshot || !m.dirty} onClick={() => save()}>Apply settings</button></>}</footer> : null}
    </ShellDialog>;
  });
  const mounted = mount(host, render, owner.source);
  const dispose = () => { if (disposed) return; disposed = true; mounted.dispose(); void Effect.runPromise(owner.close()); };
  run(async () => { accept(await port.get()); focusFirst(); });
  return { dispose, toggle: () => { if (!state.settings) close(); } };
}
