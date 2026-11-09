import { decodeSourceUpdate, type SourceUpdateState } from './source-updates';
import { sourceURL, type DownloadedSource, type SourceFolderPort } from './source-files';
import type { UserCSSConfiguration } from './usercss-types';
import type { StyleSection, StyleCondition } from './user-styles';
import { decodeStyleImports, type StyleImports } from './style-imports';

export interface UserStyle extends SourceUpdateState {
  readonly sourceURL?: string;
  readonly sourceBaseURL?: string;
  readonly dependencyRevision?: string;
  readonly imports?: StyleImports;
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly source: string;
  readonly sections: readonly StyleSection[];
  readonly usercss?: UserCSSConfiguration;
}
export interface StyleSnapshot {
  readonly revision: number;
  readonly items: readonly UserStyle[];
}
export interface UserStylePort {
  status?(): Promise<StyleMatchStatus>;
  fetchSource?(url: string, signal?: AbortSignal): Promise<DownloadedSource>;
  readonly folders?: SourceFolderPort['folders'];
  list(): Promise<StyleSnapshot>;
  replace(snapshot: StyleSnapshot): Promise<StyleSnapshot>;
}

export interface StyleMatchStatus {
  readonly revision: number;
  readonly url: string;
  readonly evaluated: boolean;
  readonly skippedConditions: number;
  readonly styleIds: readonly string[];
}

export function decodeStyleMatchStatus(input: unknown): StyleMatchStatus {
  const value = input as Partial<StyleMatchStatus> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isSafeInteger(value.revision) || value.revision! < 0
    || typeof value.url !== 'string' || value.url.length > 2 * 1024 * 1024
    || typeof value.evaluated !== 'boolean'
    || !Number.isSafeInteger(value.skippedConditions) || value.skippedConditions! < 0 || value.skippedConditions! > 1024
    || !Array.isArray(value.styleIds) || value.styleIds.length > 256
    || value.styleIds.some(id => typeof id !== 'string' || !id || id.length > 128)
    || new Set(value.styleIds).size !== value.styleIds.length)
    throw new Error('Invalid user style state');
  return Object.freeze({ revision: value.revision!, url: value.url, evaluated: value.evaluated,
    skippedConditions: value.skippedConditions!, styleIds: Object.freeze([...value.styleIds]) });
}

/** Validate IPC without reparsing CSS or compiling regexes in the shell. */
export function decodeStyleSnapshot(input: unknown): StyleSnapshot {
  const invalid = (): never => { throw new Error('Invalid user style data'); };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
  };
  const root = object(input);
  if (!Number.isSafeInteger(root.revision) || (root.revision as number) < 0 || !Array.isArray(root.items) || root.items.length > 256) return invalid();
  const ids = new Set<string>();
  let sourceSize = 0;
  let cssSize = 0;
  let conditionCount = 0;
  let sectionCount = 0;
  const items = root.items.map(raw => {
    const item = object(raw);
    if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name || item.name.length > 512
      || typeof item.enabled !== 'boolean' || typeof item.source !== 'string' || !Array.isArray(item.sections)) return invalid();
    ids.add(item.id);
    if (item.sourceBaseURL !== undefined && (typeof item.sourceBaseURL !== 'string' || new URL(sourceURL(item.sourceBaseURL)).hostname !== 'derpbird-source.invalid')) return invalid();
    if (item.dependencyRevision !== undefined && (typeof item.dependencyRevision !== 'string' || !/^[a-f0-9]{64}$/.test(item.dependencyRevision))) return invalid();
    sourceSize += item.source.length;
    const imports = item.imports === undefined ? undefined : decodeStyleImports(item.imports);
    if (imports) sourceSize += Object.values(imports).reduce((sum, item) => sum + new TextEncoder().encode(item.source).length, 0);
    sectionCount += item.sections.length;
    if (sourceSize > 2 * 1024 * 1024 || sectionCount > 1024) return invalid();
    const sections = item.sections.map(rawSection => {
      const section = object(rawSection);
      if (typeof section.css !== 'string' || !Array.isArray(section.conditions)) return invalid();
      cssSize += section.css.length;
      const decodeConditions = (raw: unknown): readonly StyleCondition[] => {
        if (!Array.isArray(raw)) return invalid();
        conditionCount += raw.length;
        if (conditionCount > 1024) return invalid();
        return Object.freeze(raw.map(rawCondition => {
          const condition = object(rawCondition);
          if (!['url', 'url-prefix', 'domain', 'regexp'].includes(condition.type as string)
            || typeof condition.value !== 'string' || condition.value.length > 16384) return invalid();
          return Object.freeze({ type: condition.type as StyleCondition['type'], value: condition.value });
        }));
      };
      if (cssSize > 2 * 1024 * 1024) return invalid();
      const conditions = decodeConditions(section.conditions);
      let conditionGroups: readonly (readonly StyleCondition[])[] | undefined;
      if (section.conditionGroups !== undefined) {
        if (!Array.isArray(section.conditionGroups) || section.conditionGroups.length > 31) return invalid();
        conditionGroups = Object.freeze(section.conditionGroups.map(group => {
          const decoded = decodeConditions(group);
          if (!decoded.length) return invalid();
          return decoded;
        }));
      }
      let wrappers: StyleSection['wrappers'];
      if (section.wrappers !== undefined) {
        if (!Array.isArray(section.wrappers) || section.wrappers.length > 32) return invalid();
        wrappers = Object.freeze(section.wrappers.map(raw => {
          const wrapper = object(raw);
          if (!Number.isSafeInteger(wrapper.id) || (wrapper.id as number) < 1 || (wrapper.id as number) > 1024 || typeof wrapper.open !== 'string') return invalid();
          cssSize += new TextEncoder().encode(wrapper.open).length;
          if (cssSize > 2 * 1024 * 1024) return invalid();
          return Object.freeze({ id: wrapper.id as number, open: wrapper.open });
        }));
      }
      return Object.freeze({ css: section.css, conditions, ...(conditionGroups ? { conditionGroups } : {}), ...(wrappers ? { wrappers } : {}) });
    });
    let usercss: UserCSSConfiguration | undefined;
    if (item.usercss !== undefined) {
      const config = object(item.usercss);
      const values = object(config.values);
      if (Object.keys(values).length > 128 || new TextEncoder().encode(JSON.stringify(values)).length > 65536) return invalid();
      for (const [key,value] of Object.entries(values)) {
        if (!/^[\w-]{1,128}$/.test(key) || (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) return invalid();
      }
      usercss = Object.freeze({ values: Object.freeze({ ...values }) as UserCSSConfiguration['values'] });
    }
    return Object.freeze({ ...decodeSourceUpdate(item), ...(imports ? { imports } : {}), ...(typeof item.sourceBaseURL === 'string' ? { sourceBaseURL: sourceURL(item.sourceBaseURL) } : {}), ...(typeof item.dependencyRevision === 'string' ? { dependencyRevision: item.dependencyRevision } : {}), ...(typeof item.sourceURL === 'string' ? { sourceURL: sourceURL(item.sourceURL) } : {}), id: item.id, name: item.name, enabled: item.enabled, source: item.source, sections: Object.freeze(sections), ...(usercss ? { usercss } : {}) });
  });
  return Object.freeze({ revision: root.revision as number, items: Object.freeze(items) });
}
