import { parse, type AtRule, type ChildNode } from 'postcss';

export interface StyleCondition {
  readonly type: 'url' | 'url-prefix' | 'domain' | 'regexp';
  readonly value: string;
}
export interface StyleSection {
  /** No conditions means global; otherwise any condition may match. */
  readonly conditions: readonly StyleCondition[];
  /** Additional OR groups, each of which must match (nested document scopes). */
  readonly conditionGroups?: readonly (readonly StyleCondition[])[];
  readonly css: string;
  /** Ordered fragments of one sheet; ancestor IDs retain anonymous CSS identity. */
  readonly wrappers?: readonly { readonly id: number; readonly open: string }[];
}

export class StyleImportError extends Error {
  constructor(message: string) { super(message); this.name = 'StyleImportError'; }
}

// CSS escapes are not JSON escapes: hexadecimal escapes and escaped newlines
// are legal, and regexp backslashes have already passed through CSS quoting.
function unescapeCSS(source: string): string {
  return source.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|[\n\r\f]|([\s\S]))/gi, (_, hex: string | undefined, character: string | undefined) => {
    if (!hex) return character ?? '';
    const code = Number.parseInt(hex, 16);
    return String.fromCodePoint(!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
  });
}

export function parseStyleConditions(source: string): readonly StyleCondition[] {
  let cursor = 0;
  const conditions: StyleCondition[] = [];
  const fail = (): never => { throw new StyleImportError(`Invalid @-moz-document condition at column ${cursor + 1}`); };
  const skip = () => {
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) { cursor++; continue; }
      if (source.startsWith('/*', cursor)) {
        const end = source.indexOf('*/', cursor + 2);
        if (end < 0) fail();
        cursor = end + 2;
        continue;
      }
      break;
    }
  };
  while (cursor < source.length) {
    skip();
    const name = /^(url-prefix|url|domain|regexp)\(/i.exec(source.slice(cursor));
    if (!name) fail();
    const type = name![1].toLowerCase() as StyleCondition['type'];
    cursor += name![0].length;
    skip();
    const quote = /["']/.test(source[cursor] ?? '') ? source[cursor++] : null;
    let raw = '';
    let closed = false;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '\\') {
        if (cursor === source.length) fail();
        const escaped = /^(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|\r\n|[\s\S])/i.exec(source.slice(cursor))![0];
        if (!quote && /^[\r\n\f]/.test(escaped)) fail();
        raw += character + escaped;
        cursor += escaped.length;
      } else if (character === (quote ?? ')')) { closed = true; break; }
      else {
        if (quote ? /[\n\r\f]/.test(character) : /["'(]/.test(character)) fail();
        raw += character;
      }
    }
    if (!closed) fail();
    if (quote) { skip(); if (source[cursor++] !== ')') fail(); }
    else {
      raw = raw.trim();
      // Unquoted URL tokens cannot contain literal whitespace or comments.
      const literals = raw.replace(/\\(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|[\s\S])/gi, 'x');
      if (/\s|\/\*/.test(literals)) fail();
    }
    const value = unescapeCSS(raw);
    if (type === 'domain' && (!value || /[\s/:*?#@]/.test(value))) fail();
    conditions.push(Object.freeze({ type, value }));
    skip();
    if (cursor === source.length) break;
    if (source[cursor++] !== ',') fail();
    skip();
    if (cursor === source.length) fail();
  }
  if (!conditions.length) fail();
  return Object.freeze(conditions);
}

/** Import classic Stylish Mozilla-format CSS. Native code owns URL matching. */
export function parseUserStyle(source: string): readonly StyleSection[] {
  if (source.length > 2 * 1024 * 1024) throw new StyleImportError('Style exceeds the 2 MiB import limit');
  let root;
  try { root = parse(source, { from: undefined }); }
  catch (error) { throw new StyleImportError(error instanceof Error ? error.message : String(error)); }
  const isDocument = (node: ChildNode): boolean => node.type === 'atrule' && ['-moz-document', 'document'].includes(node.name.toLowerCase());
  // Namespace declarations scope every stylesheet section, including those
  // unwrapped from @-moz-document. Keep them ahead of section rules.
  const namespaces = root.nodes.filter(node => node.type === 'atrule' && node.name.toLowerCase() === 'namespace');
  const sections: StyleSection[] = [];
  let conditionCount = 0;
  let cssBytes = 0;
  const emit = (nodes: ChildNode[], groups: readonly (readonly StyleCondition[])[]) => {
    if (!nodes.some(node => node.type !== 'comment')) return;
    // @import must precede @namespace; @charset must precede both.
    const leading = nodes.filter(node => node.type === 'atrule' && ['charset', 'import'].includes(node.name.toLowerCase()));
    const ordered = [...leading, ...namespaces, ...nodes.filter(node => !leading.includes(node))];
    const css = root.clone({ nodes: ordered.map(node => node.clone()) }).toString();
    conditionCount += groups.reduce((count, group) => count + group.length, 0);
    cssBytes += new TextEncoder().encode(css).length;
    if (sections.length >= 1024 || conditionCount > 1024 || cssBytes > 2 * 1024 * 1024)
      throw new StyleImportError('Expanded style exceeds the registry limit');
    sections.push(Object.freeze({ conditions: groups[0] ?? Object.freeze([]),
      ...(groups.length > 1 ? { conditionGroups: Object.freeze(groups.slice(1)) } : {}), css }));
  };
  // Split only at document scopes. Keep ordinary CSS groups intact, and
  // reconstruct their ancestor wrappers around each ordered fragment.
  const documentDescendants = new WeakMap<ChildNode, boolean>();
  const hasDocument = (node: ChildNode, depth = 0): boolean => {
    if (depth > 256) throw new StyleImportError('CSS nesting exceeds 256 levels');
    const cached = documentDescendants.get(node);
    if (cached !== undefined) return cached;
    const found = isDocument(node) || ('nodes' in node && !!node.nodes?.some(child => hasDocument(child, depth + 1)));
    documentDescendants.set(node, found);
    return found;
  };
  const visit = (nodes: readonly ChildNode[], groups: readonly (readonly StyleCondition[])[], wrappers: readonly AtRule[]) => {
    if (groups.length + wrappers.length > 32) throw new StyleImportError('Style nesting exceeds 32 levels');
    let pending: ChildNode[] = [];
    const flush = () => {
      if (!pending.some(node => node.type !== 'comment')) { pending = []; return; }
      let wrapped = pending;
      for (const wrapper of [...wrappers].reverse()) wrapped = [wrapper.clone({ nodes: wrapped.map(node => node.clone()) })];
      emit(wrapped, groups);
      pending = [];
    };
    for (const node of nodes) {
      if (namespaces.includes(node)) continue;
      if (!hasDocument(node)) { pending.push(node); continue; }
      flush();
      if (node.type === 'atrule' && isDocument(node)) {
        if (!node.nodes) throw new StyleImportError('Document conditions require a block');
        visit(node.nodes, [...groups, parseStyleConditions(node.params)], wrappers);
      } else if (node.type === 'atrule' && node.nodes && ['media', 'supports', 'container', 'scope', 'starting-style'].includes(node.name.toLowerCase())) {
        visit(node.nodes, groups, [...wrappers, node]);
      } else if (node.type === 'atrule' && node.nodes && node.name.toLowerCase() === 'layer' && node.params.trim()) {
        // Named layer blocks can be reopened without changing their identity.
        // Register the layer even when none of its document conditions match:
        // omitting it would change the order of a later reopening of this layer.
        pending.push(node.clone({ nodes: [] }));
        flush();
        visit(node.nodes, groups, [...wrappers, node]);
      } else {
        // Splitting selectors, keyframes or anonymous layers changes their CSS
        // identity. Reject those instead of widening or changing the cascade.
        throw new StyleImportError('Document conditions require a document or conditional group parent');
      }
    }
    flush();
  };
  // Stateful CSS parents cannot be reopened in independently parsed sheets.
  // Retain their actual ancestry and let the renderer assemble one selected sheet.
  const needsAssembly = (nodes: readonly ChildNode[]): boolean => nodes.some(node => {
    if (!hasDocument(node) || isDocument(node)) return 'nodes' in node && !!node.nodes && needsAssembly(node.nodes);
    if (node.type !== 'atrule' || !['media', 'supports', 'container', 'scope', 'starting-style', 'layer'].includes(node.name.toLowerCase())
      || (node.name.toLowerCase() === 'layer' && !node.params.trim())) return true;
    return !!node.nodes && needsAssembly(node.nodes);
  });
  if (needsAssembly(root.nodes)) {
    type Wrapper = { readonly id: number; readonly open: string };
    let nextId = 0;
    const append = (css: string, groups: readonly (readonly StyleCondition[])[], wrappers: readonly Wrapper[]) => {
      conditionCount += groups.reduce((sum, group) => sum + group.length, 0);
      cssBytes += new TextEncoder().encode(css).length + wrappers.reduce((sum, wrapper) => sum + new TextEncoder().encode(wrapper.open).length, 0);
      if (sections.length >= 1024 || conditionCount > 1024 || cssBytes > 2 * 1024 * 1024)
        throw new StyleImportError('Expanded style exceeds the registry limit');
      sections.push(Object.freeze({ css, conditions: groups[0] ?? Object.freeze([]),
        ...(groups.length > 1 ? { conditionGroups: Object.freeze(groups.slice(1)) } : {}), wrappers: Object.freeze([...wrappers]) }));
    };
    const assemble = (nodes: readonly ChildNode[], groups: readonly (readonly StyleCondition[])[], wrappers: readonly Wrapper[]) => {
      if (groups.length + wrappers.length > 32) throw new StyleImportError('Style nesting exceeds 32 levels');
      let pending = '';
      const flush = () => { if (pending) append(pending, groups, wrappers); pending = ''; };
      for (const node of nodes) {
        if (!hasDocument(node)) { pending += node.toString() + (node.type === 'decl' || (node.type === 'atrule' && !node.nodes) ? ';' : '') + '\n'; continue; }
        flush();
        if (isDocument(node) && node.type === 'atrule') {
          if (!node.nodes) throw new StyleImportError('Document conditions require a block');
          assemble(node.nodes, [...groups, parseStyleConditions(node.params)], wrappers);
        } else if ('nodes' in node && node.nodes) {
          const empty = node.clone({ nodes: [] }).toString();
          const close = empty.lastIndexOf('}');
          if (close < 0) throw new StyleImportError('CSS parent requires a block');
          const parents = [...wrappers, Object.freeze({ id: ++nextId, open: empty.slice(0, close) })];
          // Even an empty layer/keyframes/selector block has identity and order.
          append('', groups, parents);
          assemble(node.nodes, groups, parents);
        }
      }
      flush();
    };
    assemble(root.nodes, [], []);
  } else visit(root.nodes, [], []);
  if (!sections.length) throw new StyleImportError('Style contains no CSS rules');
  return Object.freeze(sections);
}
