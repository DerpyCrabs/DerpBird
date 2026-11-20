import { openPageSources } from '@bird/ui/PageSources';
import type { ShellController } from '@bird/browser/controller';
import type { PageSources } from '@bird/browser/page-sources';
import { createStyleCompiler } from '@bird/browser/style-compiler';
import { createStyleController } from '@bird/browser/style-controller';
import { createScriptController } from '@bird/browser/script-controller';
import { mountLibrary } from '@bird/ui/preferences/library';
import type { StyleSnapshot } from '@bird/browser/style-protocol';
import type { ScriptSnapshot } from '@bird/browser/script-protocol';
import { parseUserScript } from '@bird/browser/user-scripts';

type Kind = 'styles' | 'scripts';
const css = `/* ==UserStyle==
@name Reading typography
@namespace example.test
@version 1.0.0
@var number leading "Line height" [1.65,1,2,0.05]
==/UserStyle== */
article { line-height: var(--leading); }`;
const js = (name: string) =>
  `// ==UserScript==\n// @name    ${name}\n// @match   https://example.test/*\n// @grant   GM_registerMenuCommand\n// ==/UserScript==\n\n${name === 'Copy page title' ? 'GM_registerMenuCommand("Copy page title", () => {\n  navigator.clipboard.writeText(document.title);\n});' : 'GM_registerMenuCommand("Copy clean URL", () => {\n  const url = new URL(location.href);\n  url.searchParams.delete("utm_source");\n  navigator.clipboard.writeText(url.href);\n});'}\n`;

export function createSourceLibraries(controller: ShellController) {
  let styles: StyleSnapshot = {
    revision: 1,
    items: [css, 'body { color: #eee; }'].map((source, i) => ({
      id: 'style-' + i,
      name: i ? 'Higher contrast' : 'Reading typography',
      source,
      enabled: !i,
      sections: [{ conditions: [], css: i ? source : 'article { line-height: 1.65; }' }],
      sourceURL: 'https://example.test/' + i + '.user.css',
    })),
  };
  let scripts: ScriptSnapshot = {
    revision: 1,
    items: ['Copy page title', 'Copy clean URL'].map((name, i) => ({
      id: 'script-' + i,
      name,
      source: js(name),
      metadata: parseUserScript(js(name)),
      enabled: !i,
      fileAccessGranted: false,
      sourceURL: 'https://example.test/' + i + '.user.js',
    })),
  };

  const downloads = new Map(
    [...styles.items, ...scripts.items].map((item) => [item.sourceURL!, item.source]),
  );
  const updatedCSS = 'body { color: #fff; }';
  const updatedJS = scripts.items[1].source.replace(
    'url.searchParams.delete("utm_source");',
    'url.hash = "";',
  );
  function availableUpdate<T extends { sourceURL?: string }>(item: T, source: string) {
    downloads.set(item.sourceURL!, source);
    return { ...item, pendingUpdate: { url: item.sourceURL!, source } };
  }
  styles = { ...styles, items: [styles.items[0], availableUpdate(styles.items[1], updatedCSS)] };
  scripts = { ...scripts, items: [scripts.items[0], availableUpdate(scripts.items[1], updatedJS)] };
  const dirs: Record<Kind, string[]> = { styles: [], scripts: [] };
  const folderFile = {
    styles: {
      id: 'folder_' + 'a'.repeat(64),
      name: 'Print margins',
      source: '@media print { article { margin: 2cm; } }',
    },
    scripts: {
      id: 'folder_' + 'b'.repeat(64),
      name: 'Copy clean URL from folder',
      source: js('Copy clean URL from folder'),
    },
  };
  const folderPort = (kind: Kind) => async (action: 'add' | 'remove' | 'list', path?: string) => {
    if (action === 'add') dirs[kind] = ['/examples/' + kind];
    if (action === 'remove') dirs[kind] = dirs[kind].filter((dir) => dir !== path);
    return { directories: [...dirs[kind]], files: dirs[kind].length ? [folderFile[kind]] : [] };
  };
  const fetchSource = async (url: string) => {
    const source = downloads.get(url);
    if (source === undefined) throw Error('This URL is outside the demo library.');
    return { url, source };
  };
  let popup: ReturnType<typeof openPageSources> | undefined;
  let library: ReturnType<typeof mountLibrary> | undefined;
  const page = (): PageSources => {
    const state = controller.state().browser;
    return {
      tabId: state.activeTabId!,
      url: state.tabs.find((t) => t.id === state.activeTabId)?.url ?? '',
      styles: styles.items,
      scripts: scripts.items,
      styleRevision: styles.revision,
      scriptRevision: scripts.revision,
    };
  };
  const refresh = () => controller.setPageSources(page());
  const toggle = (kind: Kind, id: string, enabled: boolean) => {
    if (kind === 'styles')
      styles = {
        revision: styles.revision + 1,
        items: styles.items.map((i) => (i.id === id ? { ...i, enabled } : i)),
      };
    else
      scripts = {
        revision: scripts.revision + 1,
        items: scripts.items.map((i) => (i.id === id ? { ...i, enabled } : i)),
      };
    refresh();
    return page();
  };
  function requireRevision(expected: number, current: number) {
    if (expected !== current) throw Error('Sources changed. Reload the current version.');
  }
  const manage = (kind: Kind, initial = 'library') => {
    popup?.close();
    if (library && !library.dismiss()) return;
    const model =
      kind === 'styles'
        ? createStyleController(
            {
              list: async () => structuredClone(styles),
              replace: async (next) => {
                requireRevision(next.revision, styles.revision);
                styles = { ...next, revision: styles.revision + 1 };
                refresh();
                return styles;
              },
              folders: folderPort(kind),
              fetchSource,
              status: async () => ({
                revision: styles.revision,
                url: page().url,
                evaluated: true,
                skippedConditions: 0,
                styleIds: [],
              }),
            },
            createStyleCompiler(fetchSource, new URL('/settings-study/compiler.js', location.href)),
          )
        : createScriptController({
            list: async () => structuredClone(scripts),
            replace: async (next) => {
              requireRevision(next.revision, scripts.revision);
              // The native registry owns file access and carries it over only for unchanged code.
              const items = next.items.map((item) => {
                const previous = scripts.items.find((entry) => entry.id === item.id);
                const fileAccessGranted =
                  !!previous?.fileAccessGranted &&
                  previous.source === item.source &&
                  previous.dependencyRevision === item.dependencyRevision &&
                  JSON.stringify(previous.metadata) === JSON.stringify(item.metadata);
                return { ...item, fileAccessGranted };
              });
              scripts = { revision: scripts.revision + 1, items };
              refresh();
              return scripts;
            },
            folders: folderPort(kind),
            fetchSource,
            setFileAccess: async (id, granted, revision) => {
              requireRevision(revision, scripts.revision);
              const item = scripts.items.find((entry) => entry.id === id);
              if (!item) throw Error('Userscript no longer exists.');
              if (item.fileAccessGranted === granted) return scripts;
              scripts = {
                revision: scripts.revision + 1,
                items: scripts.items.map((s) => (s.id === id ? { ...s, fileAccessGranted: granted } : s)),
              };
              refresh();
              return scripts;
            },
          });
    library = mountLibrary(
      document.querySelector('#content-surface')!,
      kind,
      model,
      initial,
      () => {
        library = undefined;
        document
          .querySelector<HTMLElement>(
            `button[aria-label="${kind === 'styles' ? 'Styles' : 'Scripts'} on this page"]`,
          )
          ?.focus();
      },
    );
  };
  const open = (kind: Kind) => {
    popup?.close();
    popup = openPageSources(
      document.querySelector('#style-manager-host')!,
      {
        page: async () => page(),
        toggle: async (_, k, id, enabled) => toggle(k, id, enabled),
      },
      kind,
      () => {
        popup = undefined;
      },
      refresh,
      () => manage(kind),
      () => controller.send({ type: 'tab.reload', tabId: page().tabId }),
    );
  };
  return {
    manage,
    open,
    refresh,
    dispose() {
      popup?.dispose();
      library?.dispose();
    },
  };
}
