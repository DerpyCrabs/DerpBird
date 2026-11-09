// 64 symbols: masking a uniformly random byte has no modulo bias. Rejection
// samples whole candidates to meet common site character-class requirements.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const generatedPasswordLength = 24;
export interface PasswordRandomSource { getRandomValues(bytes: Uint8Array): Uint8Array }
export function generatePassword(random: PasswordRandomSource = globalThis.crypto): string {
  if (!random?.getRandomValues) throw new Error('Secure random generator unavailable.');
  const bytes = new Uint8Array(generatedPasswordLength);
  try {
    for (let attempt = 0; attempt < 128; ++attempt) {
      random.getRandomValues(bytes);
      const candidate = Array.from(bytes, byte => alphabet[byte & 63]).join('');
      if (/[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /[0-9]/.test(candidate) && /[-_]/.test(candidate)) return candidate;
    }
    throw new Error('Could not generate a password.');
  } finally { bytes.fill(0); }
}
