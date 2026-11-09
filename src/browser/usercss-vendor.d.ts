declare module 'usercss-meta' {
  export function createParser(options?: unknown): {
    parse(source: string): { metadata: unknown };
    validateVar(variable: unknown): void;
  };
}
declare module 'less/lib/less/index.js' {
  const create: (environment?: unknown, fileManagers?: unknown[]) => {
    PluginLoader?: unknown;
    AbstractFileManager: new () => { tryAppendExtension(path: string, extension: string): string };
    environment: { addFileManager(manager: unknown): void };
    render(source: string, options: unknown): Promise<{ css: string }>;
  };
  export default create;
}
declare module 'stylus-lang-bundle/dist/stylus-lang-bundle.min.js' {
  export interface StylusNode {
    first: StylusNode;
    name?: string;
    string?: string;
    filename?: string;
    path: StylusNode;
    once?: boolean;
    parent?: StylusNode;
    scope?: boolean;
    clone(parent?: StylusNode): StylusNode;
  }
  interface Renderer { render(callback: (error: Error | null, css: string) => void): void }
  const stylus: {
    (source: string, options?: unknown): Renderer;
    Evaluator: new (root: StylusNode, options: Record<string, unknown>) => {
      return: number;
      options: Record<string, unknown>;
      currentBlock: StylusNode;
      visit(node: StylusNode): StylusNode;
      visitImport(node: StylusNode): StylusNode;
    };
    Parser: new (source: string, options?: Record<string, unknown>) => { parse(): StylusNode };
    nodes: { filename: string; null: StylusNode; Block: new () => StylusNode };
  };
  export default stylus;
}

declare module '*?worker&url' { const url: string; export default url; }
