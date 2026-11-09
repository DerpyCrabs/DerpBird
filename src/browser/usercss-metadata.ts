import { createParser } from 'usercss-meta';
import type { UserCSSMetadata, UserCSSValue, UserCSSValues, UserCSSVariable } from './usercss-types';

const parser = createParser();
export function userCSSHeader(source: string): string | null {
  const start = /\/\*\s*==UserStyle==/i.exec(source);
  if (!start) return null;
  const end = source.indexOf('==/UserStyle==', start.index);
  if (end < 0 || end - start.index > 65536) throw new Error('Unterminated or oversized UserCSS header.');
  const close = source.indexOf('*/', end);
  if (close < 0 || close - end > 128) throw new Error('Unterminated UserCSS header.');
  return source.slice(start.index, close + 2);
}
export function readUserCSS(source: string): UserCSSMetadata | null {
  const header = userCSSHeader(source);
  if (!header) return null;
  const metadata = parser.parse(header).metadata as UserCSSMetadata;
  const preprocessor = metadata.preprocessor || 'default';
  if (!['default','uso','less','stylus'].includes(preprocessor)) throw new Error(`Unknown preprocessor: ${preprocessor}`);
  const variables = Object.values(metadata.vars || {});
  if (variables.length > 128) throw new Error('Too many style options (maximum 128).');
  for (const variable of variables) {
    if (!/^[\w-]{1,128}$/.test(variable.name)) throw new Error('Invalid UserCSS option name.');
    if (variable.options && variable.options.length > 256) throw new Error('Too many UserCSS option choices.');
  }
  return { ...metadata, preprocessor, vars: metadata.vars || {} };
}
export function userCSSValues(metadata: UserCSSMetadata, input: UserCSSValues): Record<string, UserCSSValue> {
  const values: Record<string, UserCSSValue> = Object.create(null);
  for (const variable of Object.values(metadata.vars)) {
    let value = Object.hasOwn(input, variable.name) ? input[variable.name] : variable.default;
    if (['number','range','checkbox'].includes(variable.type)) {
      if (typeof value === 'string' && value.trim() !== '') value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`«${variable.label}»: Enter a number.`);
    } else if (typeof value !== 'string') throw new Error(`«${variable.label}»: Expected a string.`);
    if (variable.options && !variable.options.some(option => option.name === value)) throw new Error(`«${variable.label}»: Choose an available option.`);
    if (String(value).length > 16384) throw new Error(`«${variable.label}»: Value is too long.`);
    parser.validateVar({ ...variable, value: variable.type === 'checkbox' ? String(value) : value } as UserCSSVariable);
    values[variable.name] = value;
  }
  if (new TextEncoder().encode(JSON.stringify(values)).length > 65536) throw new Error('Style options exceed 64 KiB.');
  return values;
}
export function resolvedUserCSSValues(metadata: UserCSSMetadata, values: UserCSSValues): Record<string, string> {
  return Object.fromEntries(Object.values(metadata.vars).map(variable => {
    const value = values[variable.name];
    return [variable.name, variable.options?.find(option => option.name === value)?.value
      ?? String(value) + (['number','range'].includes(variable.type) ? variable.units || '' : '')];
  }));
}
