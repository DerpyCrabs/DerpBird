export interface ImportProfile { id: string; name: string }
export interface ImportStatus { welcome: boolean; profiles: ImportProfile[] }
export interface ImportSelection { profile: string; bookmarks: boolean; history: boolean; tabs: boolean }
export interface ImportReport { bookmarks?: number; history?: number; tabs?: number; passwords?: number; skipped?: number; failed?: number; warnings?: string[]; cancelled?: boolean }
export interface ImportPort {
  status(): Promise<ImportStatus>;
  dismiss(): Promise<void>;
  chrome(selection: ImportSelection): Promise<ImportReport>;
  passwords(): Promise<ImportReport>;
}
export function decodeImportStatus(value: unknown): ImportStatus {
  const v = value as ImportStatus;
  if (!v || typeof v.welcome !== 'boolean' || !Array.isArray(v.profiles) || v.profiles.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string')) throw new Error('Invalid import profiles');
  return v;
}
export function decodeImportReport(value: unknown): ImportReport {
  const v = value as ImportReport;
  if (!v || typeof v !== 'object') throw new Error('Invalid import result');
  for (const key of ['bookmarks', 'history', 'tabs', 'passwords', 'skipped', 'failed'] as const)
    if (v[key] !== undefined && (!Number.isSafeInteger(v[key]) || v[key]! < 0)) throw new Error('Invalid import count');
  if (v.warnings !== undefined && (!Array.isArray(v.warnings) || v.warnings.some(x => typeof x !== 'string'))) throw new Error('Invalid import warnings');
  if (v.cancelled !== undefined && typeof v.cancelled !== 'boolean') throw new Error('Invalid import cancellation');
  return v;
}
