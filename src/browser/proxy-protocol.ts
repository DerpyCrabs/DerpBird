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
export interface ProxyPort { get(): Promise<ProxySnapshot>; replace(snapshot: ProxySnapshot): Promise<ProxySnapshot> }
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
