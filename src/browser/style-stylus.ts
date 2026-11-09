import type { StylusNode } from 'stylus-lang-bundle/dist/stylus-lang-bundle.min.js';
import { sourceURL, type DownloadedSource } from './source-files';
import type { StyleCompileContext } from './style-imports';

/** Keep Stylus evaluation/scoping intact; only replace its unavailable filesystem.
 * Evaluation is synchronous, so a missing dependency suspends the attempt. After
 * the host resolves it, evaluate a fresh AST. Dynamic paths thus use actual
 * variables/conditionals, rather than a textual import preprocessor.
 */
export async function compileStylus(
  source: string,
  context: StyleCompileContext,
  load: (url: string) => Promise<DownloadedSource>,
): Promise<string> {
  const { default: stylus } = await import('stylus-lang-bundle/dist/stylus-lang-bundle.min.js');
  const files = new Map<string, DownloadedSource>();
  // The browser bundle locates its standard library relative to this filename
  // using POSIX path helpers. A URL there breaks its internal lookup. Source
  // imports still resolve against context.sourceURL (or an imported node URL).
  const filename = 'userstyle.styl';
  const available = new Set(context.importURLs ?? []);
  for (let attempt = 0; attempt <= 32; attempt++) {
    let missing: string | undefined;
    class ImportEvaluator extends stylus.Evaluator {
      private readonly active: string[] = [];
      private readonly required = new Set<string>();
      visitImport(node: StylusNode): StylusNode {
        this.return++;
        let path: StylusNode;
        try { path = this.visit(node.path).first; }
        finally { this.return--; }
        const name = path.string;
        // Preserve the bundled standard library and CSS imports. In Stylus an
        // absolute HTTP import is CSS, not an instruction to evaluate code.
        const builtin = (this.options.imports as readonly string[] | undefined)?.[0];
        if (name === builtin || path.name === 'url'
          || (name && /^(?:#|(?:https?:)?\/\/)/i.test(name))) return super.visitImport(node);
        if (!name) throw new Error('Stylus: Expected a dependency path string.');
        const base = node.filename && node.filename !== 'userstyle.styl' ? node.filename : context.sourceURL;
        if (/\.css$/i.test(name)) {
          if (!node.once) return node;
          const key = base ? new URL(name, base).href : name;
          if (this.required.has(key)) return stylus.nodes.null;
          this.required.add(key);
          return node;
        }
        const address = sourceURL(new URL(/\.styl$/i.test(name) ? name : name + '.styl', base).href);
        // Native directory snapshots also permit the standard directory/index
        // spelling, without probing arbitrary filesystem paths or the network.
        const index = sourceURL(new URL(name.replace(/\/$/, '') + '/index.styl', base).href);
        const key = !(context.imports?.[address] || available.has(address)) && (context.imports?.[index] || available.has(index)) ? index : address;
        const file = files.get(key);
        if (!file) {
          missing = key;
          throw new Error('Waiting for a Stylus dependency.');
        }
        if (node.once && this.required.has(file.url)) return stylus.nodes.null;
        if (this.active.includes(file.url)) throw new Error('Circular Stylus import: ' + file.url);
        if (node.once) this.required.add(file.url);
        if (!file.source.trim()) return stylus.nodes.null;
        this.active.push(file.url);
        const previousFilename = stylus.nodes.filename;
        try {
          stylus.nodes.filename = file.url;
          let parsed: StylusNode;
          try {
            parsed = new stylus.Parser(file.source, {
              ...this.options, filename: file.url, root: new stylus.nodes.Block(),
            }).parse();
          } catch (error) {
            if (error instanceof Error) Object.assign(error, { filename: file.url, input: file.source });
            throw error;
          }
          const block = parsed.clone(this.currentBlock);
          block.parent = this.currentBlock;
          block.scope = false;
          return this.visit(block);
        } finally {
          stylus.nodes.filename = previousFilename;
          this.active.pop();
        }
      }
    }
    try {
      return await new Promise<string>((resolve, reject) =>
        stylus(source, { cache: false, filename, Evaluator: ImportEvaluator })
          .render((error, css) => error ? reject(error) : resolve(css)));
    } catch (error) {
      if (!missing) throw error;
      if (attempt === 32) throw new Error('At most 32 style dependencies are allowed.');
      files.set(missing, await load(missing));
    }
  }
  throw new Error('Stylus dependency limit exceeded.');
}
