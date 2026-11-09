import type { SourceFolderSnapshot } from './source-files';
import type { UserScriptPort, UserScript } from './script-protocol';
import type { UserStylePort, UserStyle } from './style-protocol';
import { createStyleCompiler, type StyleCompiler } from './style-compiler';
import { parseUserScript } from './user-scripts';

/** A revision identifies disk source and dependencies, independently of editor overrides. */
export function sameFolderSnapshot(old: { source: string; dependencyRevision?: string } | undefined, file: { source: string; dependencyRevision?: string }): boolean {
  return !!old && (file.dependencyRevision !== undefined
    ? old.dependencyRevision === file.dependencyRevision
    : old.source === file.source && old.dependencyRevision === undefined);
}

export async function syncScriptFolders(port: UserScriptPort, canContinue: () => boolean = () => true) {
  if (!port.folders || !canContinue()) return;
  const folder = await port.folders('list');
  await reconcileScriptFolders(port, folder, canContinue);
}

export async function reconcileScriptFolders(port: UserScriptPort, folder: SourceFolderSnapshot, canContinue: () => boolean = () => true) {
  if (!canContinue()) return;
  if (folder.error) throw new Error(folder.error);
  const snapshot = await port.list();
  if (!canContinue()) return;
  const previous = new Map(snapshot.items.map(item => [item.id, item]));
  let changed = false;
  const items: UserScript[] = snapshot.items.filter(item => !item.id.startsWith('folder_'));
  for (const file of folder.files) {
    if (!canContinue()) return;
    const old = previous.get(file.id);
    if (old && sameFolderSnapshot(old, file)) { items.push(old); continue; }
    changed = true;
    const metadata = parseUserScript(file.source);
    items.push({ ...file, name: metadata.name || file.name, enabled: old?.enabled ?? true, fileAccessGranted: false, metadata });
  }
  if (canContinue() && (items.length !== snapshot.items.length || changed))
    return port.replace({ revision: snapshot.revision, items });
  return canContinue() ? snapshot : undefined;
}
export async function syncStyleFolders(port: UserStylePort, canContinue: () => boolean = () => true, signal?: AbortSignal) {
  if (!port.folders || !canContinue()) return;
  const folder = await port.folders('list');
  if (!canContinue()) return;
  const compiler = createStyleCompiler(port.fetchSource?.bind(port));
  const cancel = () => compiler.close();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try { await reconcileStyleFolders(port, folder, compiler, () => !signal?.aborted && canContinue()); }
  finally { signal?.removeEventListener('abort', cancel); compiler.close(); }
}

export async function reconcileStyleFolders(port: UserStylePort, folder: SourceFolderSnapshot, compiler: StyleCompiler, canContinue: () => boolean = () => true) {
  if (!canContinue()) return;
  if (folder.error) throw new Error(folder.error);
  const snapshot = await port.list();
  if (!canContinue()) return;
  const previous = new Map(snapshot.items.map(item => [item.id, item]));
  let changed = false;
  const items: UserStyle[] = snapshot.items.filter(item => !item.id.startsWith('folder_'));
  for (const file of folder.files) {
    if (!canContinue()) return;
    const old = previous.get(file.id);
    if (old && sameFolderSnapshot(old, file)) { items.push(old); continue; }
    changed = true;
    const compiled = await compiler.compile(file.source, old?.usercss?.values, { sourceURL: file.sourceBaseURL, imports: folder.imports });
    items.push({ ...file, name: compiled.metadata?.name || file.name, enabled: old?.enabled ?? true, sections: compiled.sections, ...(compiled.imports ? { imports: compiled.imports } : {}),
      ...(compiled.metadata ? { usercss: { values: compiled.values } } : {}) });
  }
  if (canContinue() && (items.length !== snapshot.items.length || changed))
    return port.replace({ revision: snapshot.revision, items });
  return canContinue() ? snapshot : undefined;
}
