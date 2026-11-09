import type { DownloadedSource } from './source-files';
import { sourceURL } from './source-files';
import { parseUserScript } from './user-scripts';
import { compareScriptVersions } from './script-version';
import { compareStyleVersions } from './style-version';
import { readUserCSS } from './usercss-metadata';
import type { UserScriptPort } from './script-protocol';
import type { UserStylePort } from './style-protocol';
export interface SourceUpdateState {
  readonly checkUpdates?: boolean;
  readonly checkedAt?: number;
  readonly pendingUpdate?: DownloadedSource;
  readonly updateError?: string;
}
/** The installed script, never a downloaded metadata file, selects its update endpoint. */
export function scriptDownloadURL(source: string, installedURL: string): string | null {
  const metadata = parseUserScript(source, installedURL);
  const declared = metadata.entries.find(entry => entry.key === 'downloadURL')?.value;
  if (declared === 'none') return null;
  return declared ? sourceURL(new URL(declared, installedURL).href) : sourceURL(installedURL);
}
export function styleDownloadURL(source: string, installedURL: string): string {
  return sourceURL(readUserCSS(source)?.updateURL || installedURL);
}
export function decodeSourceUpdate(raw: Record<string, unknown>): SourceUpdateState {
  if (raw.checkUpdates !== undefined && typeof raw.checkUpdates !== 'boolean') throw new Error('Invalid update policy');
  if (raw.checkedAt !== undefined && (!Number.isSafeInteger(raw.checkedAt) || (raw.checkedAt as number) < 0)) throw new Error('Invalid update timestamp');
  let pendingUpdate: DownloadedSource | undefined;
  if (raw.pendingUpdate != null) {
    const update = raw.pendingUpdate as DownloadedSource;
    if (typeof update.source !== 'string' || new TextEncoder().encode(update.source).length > 2 * 1024 * 1024 || update.source.includes('\0') || typeof update.url !== 'string') throw new Error('Invalid pending update');
    pendingUpdate = { source: update.source, url: sourceURL(update.url) };
  }
  if (raw.updateError !== undefined && (typeof raw.updateError !== 'string' || raw.updateError.length > 1024)) throw new Error('Invalid update error');
  return { ...(raw.checkUpdates === undefined ? {} : { checkUpdates: raw.checkUpdates as boolean }), ...(raw.checkedAt === undefined ? {} : { checkedAt: raw.checkedAt as number }), ...(pendingUpdate ? { pendingUpdate } : {}), ...(typeof raw.updateError === 'string' ? { updateError: raw.updateError } : {}) };
}
/** Downloads are staged; the installed source and grants do not change here. */
export async function checkSourceUpdates(port: UserScriptPort | UserStylePort, scripts: boolean, now = Date.now(), canContinue: () => boolean = () => true, signal?: AbortSignal) {
  const allowed = canContinue;
  canContinue = () => !signal?.aborted && allowed();
  if (!port.fetchSource || !canContinue()) return;
  const snapshot = await port.list();
  if (!canContinue()) return;
  const candidates = snapshot.items.filter(item => item.sourceURL && item.checkUpdates && !item.pendingUpdate && now - (item.checkedAt ?? 0) >= 86_400_000)
    .toSorted((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0)).slice(0, 32);
  if (!candidates.length) return;
  const updates = new Map<string, SourceUpdateState>();
  for (const item of candidates) {
    if (!canContinue()) break;
    let address = item.sourceURL!;
    let installedVersion = "";
    try {
      if (scripts) {
        const metadata = parseUserScript(item.source, address);
        installedVersion = metadata.version;
        const declared = metadata.entries.find(entry => entry.key === 'downloadURL')?.value;
        const updateURL = metadata.entries.find(entry => entry.key === 'updateURL')?.value;
        if (declared === 'none' || updateURL === 'none') { updates.set(item.id, { checkedAt: now }); continue; }
        if (updateURL) {
          const manifest = await port.fetchSource(sourceURL(new URL(updateURL, address).href), signal);
          if (!canContinue()) return;
          const available = parseUserScript(manifest.source, manifest.url);
          if (!available.version || compareScriptVersions(available.version, installedVersion) <= 0) {
            updates.set(item.id, { checkedAt: now });
            continue;
          }
          if (!canContinue()) break;
        }
        // Installed metadata chooses the executable download endpoint. A remote
        // metadata response cannot silently redirect installation to another source.
        address = scriptDownloadURL(item.source, address)!;
      } else {
        installedVersion = readUserCSS(item.source)?.version ?? '';
        address = styleDownloadURL(item.source, address);
      }
      const downloaded = await port.fetchSource(address, signal);
      if (!canContinue()) return;
      if (scripts) {
        const available = parseUserScript(downloaded.source, downloaded.url);
        if (!available.version || compareScriptVersions(available.version, installedVersion) <= 0) {
          updates.set(item.id, { checkedAt: now });
          continue;
        }
      } else {
        const available = readUserCSS(downloaded.source);
        if (installedVersion && (!available || compareStyleVersions(available.version, installedVersion) <= 0)) {
          updates.set(item.id, { checkedAt: now });
          continue;
        }
      }
      updates.set(item.id, { checkedAt: now, ...(downloaded.source !== item.source ? { pendingUpdate: downloaded } : {}) });
    } catch (error) {
      // Native navigation cancels before pagehide can abort our signal. This is
      // not a completed daily check: leave the timestamp and registry untouched
      // so the new shell can immediately resume the interrupted batch.
      if (!canContinue()) return;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      updates.set(item.id, { checkedAt: now, updateError: (error instanceof Error ? error.message : String(error)).slice(0, 1024) });
    }
  }
  // A single CAS commit avoids overwriting edits from another window.
  if (!updates.size || !canContinue()) return;
  const items = snapshot.items.map(item => {
    const update = updates.get(item.id);
    if (!update) return item;
    const { updateError: _oldError, ...rest } = item;
    return { ...rest, ...update };
  });
  // The source service is selected by the caller; items remain the same registry type.
  await (port.replace as (value: unknown) => Promise<unknown>)({ revision: snapshot.revision, items });
}
