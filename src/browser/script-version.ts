/** Userscript versions are not SemVer: leading zeroes and missing numeric
 * components compare equally, and a release follows its prerelease suffix.
 * Keep numeric tokens as decimal strings to avoid precision loss. */
function decimal(value: string): string { return value.replace(/^0+/, '') || '0'; }
function numberOrder(left: string, right: string): number {
  const a = decimal(left), b = decimal(right);
  return a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length < b.length ? -1 : 1;
}
function qualifier(left: string, right: string): number {
  const a = left.match(/\d+|[^\d]+/g) ?? [], b = right.match(/\d+|[^\d]+/g) ?? [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const result = /^\d+$/.test(a[i]) && /^\d+$/.test(b[i]) ? numberOrder(a[i], b[i]) : a[i] < b[i] ? -1 : 1;
    if (result) return result;
  }
  return 0;
}
function part(value: string): { number: string; negative: boolean; suffix: string } {
  const match = /^(-?)(\d*)(.*)$/.exec(value)!;
  return { number: decimal(match[2]), negative: match[1] === '-' && decimal(match[2]) !== '0', suffix: match[3] };
}
function compareParts(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = part(a[i] ?? ''), y = part(b[i] ?? '');
    if (x.negative !== y.negative) return x.negative ? -1 : 1;
    const numeric = numberOrder(x.number, y.number) * (x.negative ? -1 : 1);
    if (numeric) return numeric;
    if (x.suffix === y.suffix) continue;
    if (!x.suffix) return 1;
    if (!y.suffix) return -1;
    const suffix = qualifier(x.suffix, y.suffix);
    if (suffix) return suffix;
  }
  return 0;
}
/** Ordering inferred from the published Tampermonkey @version examples:
 * https://www.tampermonkey.net/documentation.php?locale=en&q=version
 * Four numeric components precede a qualifier; an absent qualifier sorts last.
 * Calendar versions distinguish prerelease, date, timestamp and '+' suffix. */
export function compareScriptVersions(left: string, right: string): number {
  if (left.length > 4096 || right.length > 4096) throw new Error('Script version is too long.');
  const date = (value: string) => /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value.trim());
  const dateA = date(left), dateB = date(right);
  if (dateA && dateB) {
    const calendar = compareParts(dateA.slice(1, 4), dateB.slice(1, 4));
    if (calendar) return calendar;
    const phase = (suffix: string) => suffix.startsWith('+') ? 2 : suffix.startsWith('_') ? 1 : suffix ? -1 : 0;
    const phaseA = phase(dateA[4]), phaseB = phase(dateB[4]);
    if (phaseA !== phaseB) return phaseA < phaseB ? -1 : 1;
    if (!phaseA) return 0;
    return compareParts(dateA[4].slice(1).split(/[.\-]/), dateB[4].slice(1).split(/[.\-]/));
  }
  const components = (value: string) => {
    const parts = value.trim().split('.');
    // Beyond the four numeric fields, preserve the remainder as a qualifier
    // rather than treating its absence as an additional numeric zero.
    return parts.length <= 4 ? parts : [...parts.slice(0, 3), parts.slice(3).join('.')];
  };
  return compareParts(components(left), components(right));
}
