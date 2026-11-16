export interface ProxyCondition { conditionType: string; pattern?: string; ip?: string; prefixLength?: number; [key: string]: unknown }
export interface ProxyRule { condition: ProxyCondition; profileName: string; [key: string]: unknown }
export interface ProxyEndpoint { scheme: string; host?: string; port?: number; [key: string]: unknown }
export interface ProxyProfile {
  name: string; profileType: string; color?: string; revision?: string;
  fallbackProxy?: ProxyEndpoint; proxyForHttp?: ProxyEndpoint; proxyForHttps?: ProxyEndpoint; proxyForFtp?: ProxyEndpoint;
  bypassList?: ProxyCondition[]; rules?: ProxyRule[]; defaultProfileName?: string;
  [key: string]: unknown;
}
export interface ProxyOptions { schemaVersion: number; [key: string]: unknown }
export interface ProxySnapshot { revision: number; active: string; options: ProxyOptions }
export interface ProxyPort { get(): Promise<ProxySnapshot>; replace(snapshot: ProxySnapshot, currentURL?: string): Promise<ProxySnapshot>; site?(url: string): Promise<ProxySite> }
export const conditionTypes = ['HostWildcardCondition', 'UrlWildcardCondition', 'HostRegexCondition', 'UrlRegexCondition', 'KeywordCondition', 'BypassCondition', 'IpCondition', 'TrueCondition', 'FalseCondition'] as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function proxyProfiles(options: ProxyOptions): ProxyProfile[] { return Object.entries(options).filter(([key]) => key.startsWith('+')).map(([, value]) => value as ProxyProfile); }
export function validateProxyOptions(value: unknown, active?: string): ProxyOptions {
  if (!object(value) || value.schemaVersion !== 2) throw new Error('Choose a ZeroOmega / SwitchyOmega schema 2 backup.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 16 * 1024 * 1024) throw new Error('Proxy backup exceeds 16 MiB.');
  const options = value as ProxyOptions;
  const entries = Object.entries(options).filter(([key]) => key.startsWith('+'));
  if (entries.length > 128) throw new Error('Too many proxy profiles (maximum 128).');
  const names = new Set(['direct', 'system']);
  const condition = (v: unknown) => {
    if (!object(v) || !conditionTypes.includes(v.conditionType as typeof conditionTypes[number])) throw new Error(`Unsupported proxy condition: ${object(v) ? v.conditionType : 'invalid'}.`);
    if (v.conditionType === 'TrueCondition' || v.conditionType === 'FalseCondition') return;
    if (v.conditionType === 'IpCondition') {
      if (typeof v.ip !== 'string' || !v.ip || !Number.isInteger(v.prefixLength) || Number(v.prefixLength) < 0 || Number(v.prefixLength) > (v.ip.includes(':') ? 128 : 32)) throw new Error('Invalid IP condition.');
      return;
    }
    if (typeof v.pattern !== 'string' || !v.pattern || v.pattern.length > 4096) throw new Error('A proxy condition needs a pattern (maximum 4096 characters).');
    if (v.conditionType === 'HostRegexCondition' || v.conditionType === 'UrlRegexCondition') { try { new RegExp(v.pattern); } catch { throw new Error('Invalid proxy regular expression.'); } }
  };
  for (const [key, raw] of entries) {
    if (!object(raw) || typeof raw.name !== 'string' || !raw.name || raw.name.length > 256 || key !== `+${raw.name}` || names.has(raw.name)) throw new Error('Invalid or reserved proxy profile name.');
    names.add(raw.name);
    if (!['FixedProfile', 'SwitchProfile', 'VirtualProfile', 'DirectProfile', 'SystemProfile'].includes(String(raw.profileType))) throw new Error(`Unsupported profile “${raw.name}”: PAC scripts and subscription lists are not supported.`);
    if (raw.profileType === 'SwitchProfile' || raw.profileType === 'VirtualProfile') {
      if (typeof raw.defaultProfileName !== 'string') throw new Error(`Choose a default profile for “${raw.name}”.`);
      if (raw.profileType === 'SwitchProfile' && !Array.isArray(raw.rules)) throw new Error('Missing proxy rules.');
      if (raw.rules !== undefined) {
        if (!Array.isArray(raw.rules) || raw.rules.length > 20000) throw new Error('Invalid proxy rules (maximum 20000 per profile).');
        for (const rule of raw.rules) { if (!object(rule) || typeof rule.profileName !== 'string') throw new Error('Invalid rule target.'); condition(rule.condition); }
      }
    }
    if (raw.profileType === 'FixedProfile') {
      for (const field of ['fallbackProxy', 'proxyForHttp', 'proxyForHttps', 'proxyForFtp']) {
        const endpoint = raw[field];
        if (endpoint === undefined) continue;
        if (!object(endpoint)) throw new Error('Invalid proxy endpoint.');
        if (endpoint.scheme === 'direct') continue;
        if (!['http', 'https', 'socks4', 'socks5'].includes(String(endpoint.scheme)) || typeof endpoint.host !== 'string' || !endpoint.host || /[\s/@?#\\]/.test(endpoint.host) || !Number.isInteger(endpoint.port) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535) throw new Error(`Invalid proxy server in “${raw.name}”.`);
      }
      if (raw.bypassList !== undefined) {
        if (!Array.isArray(raw.bypassList) || raw.bypassList.length > 20000) throw new Error('Invalid bypass list.');
        raw.bypassList.forEach(condition);
      }
    }
  }
  if (options['-derpbirdDomainRules'] !== undefined) {
    const rules = options['-derpbirdDomainRules'];
    if (!object(rules) || Object.keys(rules).length > 20000) throw new Error('Invalid domain proxy rules.');
    for (const [host, target] of Object.entries(rules)) {
      if (host.length > 253 || proxyHost(`https://${host}/`) !== host || typeof target !== 'string' || !names.has(target)) throw new Error('Invalid domain proxy rule.');
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (name: string) => {
    if (!names.has(name)) throw new Error(`Unknown proxy profile: ${name}.`);
    if (visiting.has(name)) throw new Error(`Proxy profile cycle involving “${name}”.`);
    if (visited.has(name) || name === 'direct' || name === 'system') return;
    visiting.add(name);
    const profile = options[`+${name}`] as ProxyProfile;
    if (profile.profileType === 'SwitchProfile' || profile.profileType === 'VirtualProfile') {
      visit(profile.defaultProfileName!);
      profile.rules?.forEach(rule => visit(rule.profileName));
    }
    visiting.delete(name); visited.add(name);
  };
  for (const name of names) visit(name);
  if (active !== undefined && !names.has(active)) throw new Error(`Unknown active proxy profile: ${active}.`);
  return options;
}
export function decodeProxySnapshot(value: unknown): ProxySnapshot {
  if (!object(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.active !== 'string') throw new Error('Invalid proxy settings response.');
  return { revision: Number(value.revision), active: value.active, options: validateProxyOptions(value.options, value.active) };
}
export function importProxyBackup(text: string): ProxyOptions { return validateProxyOptions(JSON.parse(text.replace(/^\uFEFF/, ''))); }
export function exportProxyBackup(options: ProxyOptions): string { return JSON.stringify(validateProxyOptions(options), null, 2); }

export interface ProxyFailure { host: string; count: number; error: string; profile: string; proxied: boolean }
export interface ProxySite { url: string; host: string; profile: string; proxied: boolean; failures: ProxyFailure[] }
export const domainRulesKey = '-derpbirdDomainRules';
export function proxyHost(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Proxy rules require an HTTP or HTTPS page.');
  if (/[*|]/.test(parsed.hostname)) throw new Error('Proxy rules require an exact hostname.');
  return parsed.hostname.toLowerCase();
}
export function setDomainProxy(snapshot: ProxySnapshot, host: string, profile: string): ProxySnapshot {
  if (proxyHost(`https://${host}/`) !== host) throw new Error('Invalid proxy domain.');
  const options = structuredClone(snapshot.options);
  const rules = { ...(options[domainRulesKey] as Record<string, string> | undefined), [host]: profile };
  // A direct default needs no exception. A global proxy needs a direct exception
  // so switching this domain off cannot affect other domains.
  if (profile === 'direct' && snapshot.active === 'direct') delete rules[host];
  options[domainRulesKey] = rules;
  return decodeProxySnapshot({ ...snapshot, options });
}
export function decodeProxySite(value: unknown): ProxySite {
  if (!object(value) || typeof value.url !== 'string' || typeof value.host !== 'string' || proxyHost(value.url) !== value.host || typeof value.profile !== 'string' || typeof value.proxied !== 'boolean' || !Array.isArray(value.failures) || value.failures.length > 256) throw new Error('Invalid site proxy response.');
  for (const entry of value.failures) {
    if (!object(entry) || typeof entry.host !== 'string' || proxyHost(`https://${entry.host}/`) !== entry.host || !Number.isSafeInteger(entry.count) || Number(entry.count) < 1 || typeof entry.error !== 'string' || entry.error.length > 4096 || typeof entry.profile !== 'string' || typeof entry.proxied !== 'boolean') throw new Error('Invalid failed request.');
  }
  return value as unknown as ProxySite;
}
