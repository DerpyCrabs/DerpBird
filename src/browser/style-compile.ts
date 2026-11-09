import { parse } from 'postcss';
import { parseUserStyle, type StyleSection } from './user-styles';
import { readUserCSS, resolvedUserCSSValues, userCSSValues, userCSSHeader } from './usercss-metadata';
import type { UserCSSMetadata, UserCSSValues } from './usercss-types';
import { sourceURL, type DownloadedSource } from './source-files';
import { decodeStyleImports, type StyleImports, type StyleCompileContext } from './style-imports';

export interface CompiledStyle {
  readonly sections: readonly StyleSection[];
  readonly metadata: UserCSSMetadata | null;
  readonly values: UserCSSValues;
  readonly imports?: StyleImports;
}
/** Runs inside a disposable worker. No compiler has a filesystem or network loader. */
export async function compileStyle(source: string, selected: UserCSSValues = {}, context: StyleCompileContext = {}, loadImport?: (url: string) => Promise<DownloadedSource>): Promise<CompiledStyle> {
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw new Error('Style exceeds 2 MiB.');
  const metadata = readUserCSS(source);
  const values = metadata ? userCSSValues(metadata, selected) : {};
  const variables = metadata ? resolvedUserCSSValues(metadata, values) : {};
  const header = userCSSHeader(source);
  const body = header ? source.replace(header, '\n'.repeat(header.split('\n').length - 1)) : source;
  let css = body;
  const imports: Record<string, DownloadedSource> = Object.create(null);
  const cached = decodeStyleImports(context.imports ?? {}, true);
  const available = new Set((context.importURLs ?? []).map(sourceURL));
  const pending = new Map<string, Promise<DownloadedSource>>();
  const load = (address: string): Promise<DownloadedSource> => {
    const url = sourceURL(address);
    if (!pending.has(url)) {
      if (pending.size >= 32) throw new Error('At most 32 style dependencies are allowed.');
      pending.set(url, (async () => {
        if (!cached[url] && !available.has(url) && new URL(url).hostname === 'derpbird-source.invalid')
          throw new Error('Local dependency missing from the selected folder: ' + url);
        const result = cached[url] ?? await loadImport?.(url);
        if (!result) throw new Error('Style dependency downloads unavailable.');
        imports[url] = result;
        decodeStyleImports(imports);
        return result;
      })());
    }
    return pending.get(url)!;
  };
  if (metadata?.preprocessor === 'less') {
    const { default: createLess } = await import('less/lib/less/index.js');
    const less = createLess();
    class ImportManager extends less.AbstractFileManager {
      supports() { return true; }
      async loadFile(filename: string, directory: string, options: { ext?: string }) {
        const name = options.ext ? this.tryAppendExtension(filename, options.ext) : filename;
        const url = sourceURL(new URL(name, directory || context.sourceURL).href);
        const file = await load(url);
        return { contents: file.source, filename: file.url };
      }
    }
    less.environment.addFileManager(new ImportManager());
    less.PluginLoader = class { loadPlugin() { return Promise.reject(new Error('Less plugins are disabled.')); } };
    css = (await less.render(body, { javascriptEnabled: false, math: 'parens-division',
      modifyVars: variables, filename: context.sourceURL ?? 'userstyle.less', plugins: [] })).css;
  } else if (metadata?.preprocessor === 'stylus') {
    const { compileStylus } = await import('./style-stylus');
    const prefix = Object.entries(variables).map(([key,value]) => `${key} = ${value};`).join('\n');
    css = await compileStylus(`${prefix}\n${body}`, { ...context, imports: cached }, load);
  } else if (metadata?.preprocessor === 'uso') {
    const { default: Color } = await import('colorjs.io');
    const resolving = new Set<string>();
    const substitute = (text: string): string => text.replace(/\/\*\[\[([\w-]+)\]\]\*\/([\da-f]{2}(?=\W)|)/gi, (original, name: string, alpha: string) => {
      const rgb = !Object.hasOwn(variables, name) && name.endsWith('-rgb');
      const key = rgb ? name.slice(0,-4) : name;
      if (!Object.hasOwn(variables,key)) return original;
      if (resolving.has(key)) throw new Error(`Circular UserCSS substitution: ${key}`);
      const variable = metadata.vars[key];
      if (variable.type === 'color' && (rgb || alpha)) {
        const color = new Color(variables[key]).to('srgb');
        const channels = color.coords.map(value => Math.round(Math.max(0,Math.min(1,value ?? 0))*255));
        return rgb ? channels.join(', ') : '#' + channels.map(value => value.toString(16).padStart(2,'0')).join('') + alpha;
      }
      resolving.add(key);
      const result = variable.options ? substitute(variables[key]) : variables[key];
      resolving.delete(key);
      return result;
    });
    css = substitute(css);
  }
  if (new TextEncoder().encode(css).length > 2 * 1024 * 1024) throw new Error('Compiled style exceeds 2 MiB.');
  let sections = parseUserStyle(css);
  if (metadata?.preprocessor === 'default' && Object.keys(variables).length) {
    const declarations = Object.entries(variables).map(([key,value]) => `--${key}:${value};`).join('\n');
    const rootRule = parse(`:root {${declarations}}`).nodes;
    const assembled = sections.some(section => section.wrappers !== undefined);
    const variableSections: StyleSection[] = [];
    sections = sections.map(section => {
      if (assembled) {
        // Keep variable rules outside selector/keyframe ancestors without
        // breaking the contiguous structural fragments of the original sheet.
        if (section.css.trim()) variableSections.push({ conditions: section.conditions,
          ...(section.conditionGroups ? { conditionGroups: section.conditionGroups } : {}), css: `:root {${declarations}}` });
        return section;
      }
      const root = parse(section.css);
      let after = 0;
      while (after < root.nodes.length) {
        const node = root.nodes[after];
        if (node.type !== 'comment' && !(node.type === 'atrule' && ['charset','import','namespace'].includes(node.name.toLowerCase()))) break;
        after++;
      }
      root.nodes.splice(after,0,...rootRule.map(node => node.clone()));
      return { ...section, css: root.toString() };
    });
    sections = [...sections, ...variableSections];
  }
  if (sections.length > 1024 || sections.reduce((sum,section)=>sum+new TextEncoder().encode(section.css).length + (section.wrappers ?? []).reduce((n,wrapper)=>n+new TextEncoder().encode(wrapper.open).length,0),0) > 2*1024*1024
    || sections.reduce((sum, section) => sum + section.conditions.length + (section.conditionGroups ?? []).reduce((n, group) => n + group.length, 0), 0) > 1024)
    throw new Error('Compiled style exceeds limits.');
  return { sections, metadata, values, ...(Object.keys(imports).length ? { imports } : {}) };
}
