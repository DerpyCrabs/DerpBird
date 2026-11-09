/** UserCSS numeric versions (including CalVer), with SemVer prerelease precedence. */
export function compareStyleVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^v?(\d+(?:\.\d+)*)(?:-([\w-]+(?:\.[\w-]+)*))?(?:\+[\w-]+(?:\.[\w-]+)*)?$/.exec(value);
    if (!match) throw new Error('Invalid UserCSS version.');
    return { numbers: match[1]!.split('.'), pre: match[2]?.split('.') };
  };
  const numeric = (a: string, b: string) => {
    a = a.replace(/^0+/, '') || '0'; b = b.replace(/^0+/, '') || '0';
    return a.length !== b.length ? Math.sign(a.length - b.length) : a === b ? 0 : a < b ? -1 : 1;
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
    const order = numeric(a.numbers[i] ?? '0', b.numbers[i] ?? '0');
    if (order) return order;
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const order = xn && yn ? numeric(x, y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : 1;
    if (order) return order;
  }
  return 0;
}
