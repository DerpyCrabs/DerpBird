import { openCredentialManager } from '@bird/ui/CredentialManager';
import type { Credential, CredentialPort } from '@bird/browser/credential-protocol';

export function passwordStudy() {
  let sequence = 0;
  const entries = new Map<string, Credential>();
  const passwords = new Map<string, string>();
  function store(origin: string, username: string, password: string, id = String(++sequence)) {
    const entry = { id, origin, username, revision: String(Number(entries.get(id)?.revision ?? 0) + 1) };
    entries.set(id, entry);
    passwords.set(id, password);
    return entry;
  }
  for (const site of ['github.com', 'figma.com', 'linear.app', 'notion.so'])
    store('https://' + site, 'alex@example.test', 'example-only-' + site);
  const port: CredentialPort = {
    list: async () => [...entries.values()],
    save: async (draft) =>
      store(draft.origin, draft.username, draft.password || passwords.get(draft.id)!, draft.id || undefined),
    reveal: async (entry) => passwords.get(entry.id)!,
    remove: async (entry) => {
      entries.delete(entry.id);
      passwords.delete(entry.id);
    },
    copy: async (entry) => navigator.clipboard.writeText(passwords.get(entry.id)!),
  };
  let manager: ReturnType<typeof openCredentialManager> | undefined;
  return {
    open() {
      manager ??= openCredentialManager(document.querySelector('#style-manager-host')!, port, () => {
        manager = undefined;
      });
    },
    dispose() {
      manager?.dispose();
    },
  };
}
