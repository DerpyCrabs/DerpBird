import { compileStyle } from './style-compile';
import type { UserCSSValues } from './usercss-types';
import type { StyleCompileContext } from './style-imports';
import type { DownloadedSource } from './source-files';
let sequence = 0;
const imports = new Map<number, { resolve(value: DownloadedSource): void; reject(error: Error): void }>();
self.onmessage = async (event: MessageEvent<{ source: string; values: UserCSSValues; context?: StyleCompileContext; importId?: number; value?: DownloadedSource; error?: string }>) => {
  const data = event.data;
  if (data.importId !== undefined) {
    const pending = imports.get(data.importId);
    imports.delete(data.importId);
    if (data.error) pending?.reject(new Error(data.error));
    else if (data.value) pending?.resolve(data.value);
    return;
  }
  try {
    const value = await compileStyle(data.source, data.values, data.context, url => new Promise((resolve, reject) => {
      const importId = ++sequence;
      imports.set(importId, { resolve, reject });
      self.postMessage({ importId, url });
    }));
    self.postMessage({ ok: true, value });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
