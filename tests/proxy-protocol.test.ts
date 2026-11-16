import { describe, expect, test } from 'bun:test';
import { decodeProxySnapshot, exportProxyBackup, importProxyBackup, validateProxyOptions } from '../src/browser/proxy-protocol';
const backup = () => ({ schemaVersion: 2, '-startupProfileName': 'auto', '-quickSwitchProfiles': ['auto', 'direct'], '+proxy': { name: 'proxy', profileType: 'FixedProfile', fallbackProxy: { scheme: 'socks5', host: 'localhost', port: 1080 }, auth: { all: { username: 'user', password: 'fixture:only' } } }, '+auto': { name: 'auto', profileType: 'SwitchProfile', defaultProfileName: 'direct', rules: [{ condition: { conditionType: 'HostWildcardCondition', pattern: '*.example.com' }, profileName: 'proxy' }] } });
describe('ZeroOmega compatibility', () => {
  test('round trips every field, including metadata and authentication', () => { const value = backup(); expect(importProxyBackup('\uFEFF' + exportProxyBackup(value))).toEqual(value); });
  test('preserves 846 ordered rules', () => { const value = backup(); value['+auto'].rules = Array.from({ length: 846 }, (_, i) => ({ condition: { conditionType: 'HostWildcardCondition', pattern: `${i}.example.com` }, profileName: 'proxy' })); expect(importProxyBackup(exportProxyBackup(value))).toEqual(value); });
  test('rejects invalid endpoints and newer schemas', () => { const value = backup(); value['+proxy'].fallbackProxy.port = 65536; expect(() => validateProxyOptions(value)).toThrow('server'); expect(() => validateProxyOptions({ schemaVersion: 3 })).toThrow('schema 2'); });
  test('rejects unsupported profiles without dropping them', () => { const value = backup(); value['+proxy'].profileType = 'PacProfile'; expect(() => validateProxyOptions(value)).toThrow('PAC'); });
  test('rejects missing references and cycles, even in inactive profiles', () => { const value = backup(); value['+auto'].defaultProfileName = 'absent'; expect(() => validateProxyOptions(value, 'direct')).toThrow('Unknown'); value['+auto'].defaultProfileName = 'auto'; expect(() => validateProxyOptions(value, 'direct')).toThrow('cycle'); });
  test('validates IPC revisions and active selection', () => { expect(() => decodeProxySnapshot({ options: backup(), active: 'missing', revision: 1 })).toThrow('Unknown active'); expect(() => decodeProxySnapshot({ options: backup(), active: 'auto', revision: -1 })).toThrow('response'); });
  test('rejects unknown conditions and malformed regex', () => { const value = backup(); value['+auto'].rules[0].condition.conditionType = 'UnknownCondition'; expect(() => validateProxyOptions(value)).toThrow('condition'); value['+auto'].rules[0].condition = { conditionType: 'UrlRegexCondition', pattern: '[' }; expect(() => validateProxyOptions(value)).toThrow('regular expression'); });
});

import { decodeProxySite, domainRulesKey, setDomainProxy } from '../src/browser/proxy-protocol';
describe('domain proxy routing', () => {
  test('changes exactly one host without changing the default or imported rules', () => {
    const original = decodeProxySnapshot({ revision: 4, active: 'auto', options: backup() });
    const changed = setDomainProxy(original, 'example.com', 'proxy');
    expect(changed.active).toBe('auto');
    expect(changed.options['+auto']).toEqual(original.options['+auto']);
    expect(original.options[domainRulesKey]).toBeUndefined();
    expect(changed.options[domainRulesKey]).toEqual({ 'example.com': 'proxy' });
    expect(importProxyBackup(exportProxyBackup(changed.options))[domainRulesKey]).toEqual(changed.options[domainRulesKey]);
    const off = setDomainProxy(changed, 'example.com', 'direct');
    expect(off.options[domainRulesKey]).toEqual({ 'example.com': 'direct' });
  });
  test('removes an unnecessary direct exception and preserves unrelated hosts', () => {
    let value = decodeProxySnapshot({ revision: 0, active: 'direct', options: backup() });
    value = setDomainProxy(value, 'cdn.example.com', 'proxy');
    value = setDomainProxy(value, 'example.com', 'proxy');
    value = setDomainProxy(value, 'example.com', 'direct');
    expect(value.options[domainRulesKey]).toEqual({ 'cdn.example.com': 'proxy' });
  });
  test('rejects malformed domains, unconfigured profiles and corrupt persisted overrides', () => {
    const value = decodeProxySnapshot({ revision: 0, active: 'direct', options: backup() });
    for (const host of ['example.com/path', 'example.com:8080', '*.example.com', 'UPPER.example', 'user@example.com']) expect(() => setDomainProxy(value, host, 'proxy')).toThrow();
    expect(() => setDomainProxy(value, 'example.com', 'missing')).toThrow();
    expect(() => validateProxyOptions({ ...backup(), [domainRulesKey]: [] })).toThrow();
    expect(() => validateProxyOptions({ ...backup(), [domainRulesKey]: { 'example.com': 'missing' } })).toThrow();
  });
  test('validates native effective routing and failure counts', () => {
    const site = { url: 'https://example.com/a', host: 'example.com', profile: 'proxy', proxied: true, failures: [{ host: 'cdn.example.com', count: 2, error: 'Timeout reached', profile: 'direct', proxied: false }] };
    expect(decodeProxySite(site)).toEqual(site);
    expect(() => decodeProxySite({ ...site, host: 'different.example' })).toThrow();
    expect(() => decodeProxySite({ ...site, failures: [{ ...site.failures[0], count: -1 }] })).toThrow();
  });
});

describe('domain routing edge cases', () => {
  test.each(['system', 'auto', 'proxy'])('disabling a host under %s retains an explicit direct exception', active => {
    const original = decodeProxySnapshot({ revision: 9, active, options: { ...backup(), [domainRulesKey]: { 'cdn.example.com': 'proxy' } } });
    const off = setDomainProxy(original, 'example.com', 'direct');
    expect(off.active).toBe(active);
    expect(off.revision).toBe(9);
    expect(off.options[domainRulesKey]).toEqual({ 'cdn.example.com': 'proxy', 'example.com': 'direct' });
    expect(original.options[domainRulesKey]).toEqual({ 'cdn.example.com': 'proxy' });
    expect(importProxyBackup(exportProxyBackup(off.options))).toEqual(off.options);
  });
  test('parent and subdomain rules can be changed independently', () => {
    const initial = decodeProxySnapshot({ revision: 2, active: 'direct', options: backup() });
    const parent = setDomainProxy(initial, 'example.com', 'proxy');
    const child = setDomainProxy(parent, 'cdn.example.com', 'system');
    expect(setDomainProxy(child, 'example.com', 'direct').options[domainRulesKey]).toEqual({ 'cdn.example.com': 'system' });
    expect(parent.options[domainRulesKey]).toEqual({ 'example.com': 'proxy' });
  });
  test.each([0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid failed-request count %s', count => {
    expect(() => decodeProxySite({ url: 'https://example.com/', host: 'example.com', profile: 'direct', proxied: false, failures: [{ host: 'cdn.example.com', count, error: 'Timeout', profile: 'direct', proxied: false }] })).toThrow('failed request');
  });
  test('accepts an empty failure list and rejects oversized native payloads', () => {
    const site = { url: 'https://example.com/', host: 'example.com', profile: 'direct', proxied: false, failures: [] };
    expect(decodeProxySite(site)).toEqual(site);
    const failure = { host: 'cdn.example.com', count: 1, error: 'Timeout', profile: 'direct', proxied: false };
    expect(() => decodeProxySite({ ...site, failures: Array(257).fill(failure) })).toThrow();
    expect(() => decodeProxySite({ ...site, failures: [{ ...failure, error: 'x'.repeat(4097) }] })).toThrow();
  });
});
