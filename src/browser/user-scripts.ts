/** Tampermonkey metadata import. Execution and grant enforcement belong to native services. */
export type ScriptRunAt = 'document-start' | 'document-body' | 'document-end' | 'document-idle' | 'context-menu';
export interface ScriptMetadataEntry { readonly key: string; readonly value: string }
export interface UserScriptMetadata {
  readonly name: string;
  readonly namespace: string;
  readonly version: string;
  readonly description: string;
  readonly runAt: ScriptRunAt;
  /** Omitted @grant means an empty sandbox grant list; it is NOT @grant none. */
  readonly grantNone: boolean;
  readonly grants: readonly string[];
  readonly noFrames: boolean;
  readonly matches: readonly string[];
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly requires: readonly string[];
  readonly resources: readonly { readonly name: string; readonly url: string }[];
  readonly connects: readonly string[];
  /** Retain localized and future directives for review, GM_info and capability validation. */
  readonly entries: readonly ScriptMetadataEntry[];
  readonly header: string;
}
export class ScriptImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ScriptImportError'; }
}

/** Read only a leading metadata comment. Never execute/parse the JavaScript body as metadata. */
export function parseUserScript(source: string, installURL?: string): UserScriptMetadata {
  const fail = (message: string): never => { throw new ScriptImportError(message); };
  if (source.length > 2 * 1024 * 1024) fail('Script exceeds the 2 MiB import limit');
  let cursor = 0;
  let start = -1;
  let end = -1;
  const entries: ScriptMetadataEntry[] = [];
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '') || source[cursor] === '\ufeff') cursor++;
    if (start < 0 && source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2);
      if (close < 0) fail('Unterminated comment before userscript metadata');
      cursor = close + 2;
      continue;
    }
    if (!source.startsWith('//', cursor)) break;
    const lineStart = cursor;
    let lineEnd = cursor + 2;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r' && source[lineEnd] !== '\u2028' && source[lineEnd] !== '\u2029') lineEnd++;
    const text = source.slice(cursor + 2, lineEnd).trim();
    cursor = lineEnd;
    if (start < 0) {
      if (text === '==UserScript==') start = lineStart;
      continue;
    }
    if (cursor - start > 64 * 1024) fail('Userscript metadata exceeds 64 KiB');
    if (text === '==/UserScript==') { end = lineEnd; break; }
    if (text === '==UserScript==') fail('Nested userscript metadata block');
    if (!text.startsWith('@')) continue;
    const entry = /^@([a-zA-Z][\w:-]*)(?:[\t ]+(.*))?$/.exec(text);
    if (!entry) fail('Malformed userscript metadata directive');
    if (entries.length >= 1024) fail('Too many userscript metadata directives');
    entries.push(Object.freeze({ key: entry![1], value: (entry![2] ?? '').trim() }));
  }
  if (start < 0) fail('Missing leading ==UserScript== metadata block');
  if (end < 0) fail('Unterminated userscript metadata block');
  const all = (key: string): readonly string[] => Object.freeze(entries.filter(entry => entry.key === key).map(entry => entry.value));
  const single = (key: string, fallback = ''): string => {
    const values = all(key);
    if (values.length > 1) fail(`Duplicate @${key} directive`);
    return values[0] ?? fallback;
  };
  const name = single('name');
  if (!name) fail('Userscript @name is required');
  const runAt = single('run-at', 'document-idle');
  if (!['document-start', 'document-body', 'document-end', 'document-idle', 'context-menu'].includes(runAt)) fail('Unknown @run-at value');
  const sandbox = single('sandbox');
  if (sandbox && !['raw', 'DOM', 'JavaScript'].includes(sandbox)) fail('Unknown @sandbox value');
  let requestRules = 0;
  for (const entry of all('webRequest')) {
    let rules: unknown;
    try { rules = JSON.parse(entry); }
    catch { fail('Invalid JSON in @webRequest'); }
    for (const rule of Array.isArray(rules) ? rules : [rules]) {
      if (!rule || typeof rule !== 'object' || !('selector' in rule) || !('action' in rule)) fail('Expected @webRequest selector and action');
      if (++requestRules > 128) fail('Too many @webRequest rules');
    }
  }
  const grants = [...new Set(all('grant'))];
  if (grants.some(value => !value || /\s/.test(value))) fail('Invalid @grant value');
  const grantNone = grants.includes('none');
  if (grantNone && grants.length > 1) fail('@grant none cannot be combined with other grants');
  const dependencyURL = (value: string) => {
    if (!installURL) return value;
    const url = new URL(value, installURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Dependency URL must be HTTP(S), without credentials');
    return url.href;
  };
  const resources: { readonly name: string; readonly url: string }[] = [];
  const resourceNames = new Set<string>();
  for (const resource of all('resource')) {
    const parsed = /^(\S+)[\t ]+(\S+)$/.exec(resource);
    if (!parsed) fail('Expected @resource name URL');
    const [, name, url] = parsed!;
    if (resourceNames.has(name)) fail(`Duplicate resource name: ${name}`);
    resourceNames.add(name);
    resources.push(Object.freeze({ name, url: dependencyURL(url) }));
  }
  for (const key of ['match', 'include', 'exclude', 'exclude-match', 'require', 'connect']) {
    if (all(key).some(value => !value)) fail(`Empty @${key} directive`);
  }
  return Object.freeze({
    name, namespace: single('namespace'), version: single('version'), description: single('description'),
    runAt: runAt as ScriptRunAt, grantNone, grants: Object.freeze(grantNone ? [] : grants),
    noFrames: all('noframes').length > 0,
    matches: all('match'), includes: all('include'), excludes: all('exclude'), excludeMatches: all('exclude-match'),
    requires: Object.freeze(all('require').map(dependencyURL)), resources: Object.freeze(resources), connects: all('connect'),
    entries: Object.freeze(entries), header: source.slice(start, end),
  });
}
