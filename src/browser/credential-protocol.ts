export interface Credential {
  readonly id: string;
  readonly origin: string;
  readonly username: string;
  /** Decimal SQLite i64; never round through a JavaScript number. */
  readonly revision: string;
}
export interface CredentialDraft extends Credential { readonly password: string }
export interface CapturedCredential { readonly token: string; readonly origin: string; readonly username: string }
export interface CredentialPort {
  exceptions?: {
    list(): Promise<readonly string[]>;
    never(token: string): Promise<readonly string[]>;
    allow(origin: string): Promise<readonly string[]>;
  };
  capture?: {
    read(): Promise<CapturedCredential>;
    save(token: string, target: Credential | null): Promise<Credential>;
    cancel(token: string): Promise<void>;
  };
  list(): Promise<readonly Credential[]>;
  save(draft: CredentialDraft): Promise<Credential>;
  remove(entry: Credential): Promise<void>;
  reveal(entry: Credential): Promise<string>;
  copy(entry: Credential): Promise<void>;
  fill?(entry: Credential): Promise<void>;
}
const invalid = (): never => { throw new Error('Invalid password manager data'); };
const bytes = (value: string) => new TextEncoder().encode(value).length;
function fields(input: unknown, creating: boolean): Credential {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !(creating && value.id === '' || /^[a-zA-Z0-9-]{1,64}$/.test(value.id))
    || typeof value.origin !== 'string' || bytes(value.origin) > 2048
    || typeof value.username !== 'string' || bytes(value.username) > 1024
    || typeof value.revision !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value.revision)
    || BigInt(value.revision) > 9223372036854775807n) return invalid();
  if (creating ? (value.id === '') !== (value.revision === '0') : value.revision === '0') return invalid();
  let url: URL;
  try { url = new URL(value.origin); } catch { return invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.origin) return invalid();
  return Object.freeze({ id: value.id, origin: value.origin, username: value.username, revision: value.revision });
}
export function decodeCredential(input: unknown): Credential {
  const entry = fields(input, false);
  if (Object.keys(input as object).some(key => !['id', 'origin', 'username', 'revision'].includes(key))) return invalid();
  return entry;
}
export function decodeCredentials(input: unknown): readonly Credential[] {
  if (!input || typeof input !== 'object' || !('items' in input) || !Array.isArray(input.items) || input.items.length > 4096) return invalid();
  const entries = input.items.map(decodeCredential);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) return invalid();
  return Object.freeze(entries);
}
export function validateCredentialDraft(input: CredentialDraft): CredentialDraft {
  const entry = fields(input, true);
  if (typeof input.password !== 'string' || bytes(input.password) > 65536) return invalid();
  return { ...entry, password: input.password };
}

export function decodeRevealedCredential(input: unknown): string {
  if (!input || typeof input !== 'object' || !('password' in input) || typeof input.password !== 'string' || bytes(input.password) > 65536) return invalid();
  return input.password;
}

export function validateCaptureToken(token: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) return invalid();
  return token;
}
export function decodeCapturedCredential(input: unknown): CapturedCredential {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['token', 'origin', 'username'].includes(key)) || typeof value.token !== 'string') return invalid();
  const entry = fields({ id: '', revision: '0', origin: value.origin, username: value.username }, true);
  return Object.freeze({ token: validateCaptureToken(value.token), origin: entry.origin, username: entry.username });
}

export function validateCredentialOrigin(origin: string): string {
  return fields({ id: '', revision: '0', origin, username: '' }, true).origin;
}
export function decodeCredentialExceptions(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object' || !('origins' in input) || !Array.isArray(input.origins) || input.origins.length > 4096) return invalid();
  const origins = input.origins.map(origin => validateCredentialOrigin(origin));
  if (new Set(origins).size !== origins.length) return invalid();
  return Object.freeze(origins);
}
