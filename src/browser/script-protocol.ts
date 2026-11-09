import { decodeSourceUpdate, type SourceUpdateState } from './source-updates';
import { sourceURL, type DownloadedSource, type SourceFolderPort } from './source-files';
import type { UserScriptMetadata } from './user-scripts';

export type ScriptExecutionMetadata = Pick<UserScriptMetadata, 'runAt' | 'grantNone' | 'noFrames' | 'matches' | 'includes' | 'excludes' | 'excludeMatches' | 'grants' | 'requires' | 'connects' | 'resources'>;
export interface UserScript extends SourceUpdateState {
  readonly sourceURL?: string;
  readonly dependencyRevision?: string;
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly fileAccessGranted: boolean;
  readonly metadata: ScriptExecutionMetadata;
  readonly dependenciesReady?: boolean;
  readonly resourcesReady?: boolean;
}
export interface ScriptSnapshot { readonly revision: number; readonly items: readonly UserScript[] }
export interface UserScriptPort {
  setFileAccess?(id: string, granted: boolean, revision: number): Promise<ScriptSnapshot>;
  fetchSource?(url: string, signal?: AbortSignal): Promise<DownloadedSource>;
  readonly folders?: SourceFolderPort['folders'];
  list(): Promise<ScriptSnapshot>;
  replace(snapshot: ScriptSnapshot): Promise<ScriptSnapshot>;
}

/** Validate native messages without executing or reparsing the script body. */
export function decodeScriptSnapshot(input: unknown): ScriptSnapshot {
  const fail = (): never => { throw new Error('Invalid userscript data'); };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    return value as Record<string, unknown>;
  };
  const root = object(input);
  if (!Number.isSafeInteger(root.revision) || (root.revision as number) < 0 || !Array.isArray(root.items) || root.items.length > 256) return fail();
  const ids = new Set<string>();
  const encoder = new TextEncoder();
  let sourceBytes = 0;
  const items = root.items.map(raw => {
    const item = object(raw);
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name || encoder.encode(item.name).length > 1024
      || typeof item.source !== 'string' || typeof item.enabled !== 'boolean' || typeof item.fileAccessGranted !== 'boolean') return fail();
    ids.add(item.id);
    const size = encoder.encode(item.source).length;
    sourceBytes += size;
    if (size > 2 * 1024 * 1024 || sourceBytes > 8 * 1024 * 1024) return fail();
    const meta = object(item.metadata);
    if (!['document-start', 'document-body', 'document-end', 'document-idle', 'context-menu'].includes(meta.runAt as string)
      || typeof meta.grantNone !== 'boolean' || typeof meta.noFrames !== 'boolean') return fail();
    let count = 0; let bytes = 0;
    const string = (value: unknown): string => {
      if (typeof value !== 'string' || value.includes('\0')) return fail();
      bytes += encoder.encode(value).length;
      if (bytes > 64 * 1024) return fail();
      return value;
    };
    const strings = (value: unknown): readonly string[] => {
      if (!Array.isArray(value) || (count += value.length) > 1024) return fail();
      return Object.freeze(value.map(string));
    };
    const matches = strings(meta.matches), includes = strings(meta.includes), excludes = strings(meta.excludes), excludeMatches = strings(meta.excludeMatches);
    const grants = strings(meta.grants), requires = strings(meta.requires), connects = strings(meta.connects);
    if (meta.grantNone && grants.length) return fail();
    if (!Array.isArray(meta.resources) || (count += meta.resources.length) > 1024) return fail();
    const resourceNames = new Set<string>();
    const resources = Object.freeze(meta.resources.map(raw => {
      const resource = object(raw);
      const name = string(resource.name), url = string(resource.url);
      if (!name || !url || resourceNames.has(name)) return fail();
      resourceNames.add(name);
      return Object.freeze({ name, url });
    }));
    if (item.dependencyRevision !== undefined && (typeof item.dependencyRevision !== 'string' || !/^[a-f0-9]{64}$/.test(item.dependencyRevision))) return fail();
    const metadata: ScriptExecutionMetadata = Object.freeze({ ...meta, runAt: meta.runAt as ScriptExecutionMetadata['runAt'], grantNone: meta.grantNone, noFrames: meta.noFrames, matches, includes, excludes, excludeMatches, grants, requires, connects, resources });
    return Object.freeze({ ...decodeSourceUpdate(item), ...(typeof item.dependencyRevision === 'string' ? { dependencyRevision: item.dependencyRevision } : {}), ...(typeof item.sourceURL === 'string' ? { sourceURL: sourceURL(item.sourceURL) } : {}), id: item.id, name: item.name, source: item.source, enabled: item.enabled, fileAccessGranted: item.fileAccessGranted, metadata, resourcesReady: resources.length === 0 || (Array.isArray(item.cachedResources) && item.cachedResources.length === resources.length), dependenciesReady: requires.length === 0 || (Array.isArray(item.requiredSources) && item.requiredSources.length === requires.length) });
  });
  return Object.freeze({ revision: root.revision as number, items: Object.freeze(items) });
}

export function scriptExecutionNotice(script: UserScript): string | null {
  const m = script.metadata;
  if (m.grants.some(grant => !['GM_webRequest', 'GM.audio', 'GM_audio', 'window.onurlchange', 'window.close', 'window.focus', 'unsafeWindow', 'GM.cookie', 'GM_cookie', 'GM.notification', 'GM_notification', 'GM.download', 'GM_download', 'GM.getTab', 'GM_getTab', 'GM.saveTab', 'GM_saveTab', 'GM.getTabs', 'GM_getTabs', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_getValues', 'GM_setValues', 'GM_deleteValues', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_registerMenuCommand', 'GM.registerMenuCommand', 'GM_unregisterMenuCommand', 'GM.unregisterMenuCommand', 'GM_openInTab', 'GM.openInTab', 'GM_log', 'GM.log', 'GM_addElement', 'GM.addElement', 'GM_setClipboard', 'GM.setClipboard', 'GM.xmlHttpRequest', 'GM_xmlhttpRequest', 'GM_getResourceText', 'GM_getResourceURL', 'GM.getResourceText', 'GM.getResourceUrl', 'GM.getResourceURL', 'GM_info', 'GM.info', 'GM_addStyle', 'GM.addStyle', 'GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.listValues', 'GM.getValues', 'GM.setValues', 'GM.deleteValues', 'GM.addValueChangeListener', 'GM.removeValueChangeListener'].includes(grant)) || (m.requires.length > 0 && !script.dependenciesReady) || (m.resources.length > 0 && !script.resourcesReady))
    return 'Saved but inactive: unsupported @grant or missing @require/@resource.';
  if (m.runAt === 'context-menu') return 'Run from the page context menu.';
  if (!m.matches.length && !m.includes.length) return 'Inactive: add @match or @include for the intended sites.';
  return null;
}
