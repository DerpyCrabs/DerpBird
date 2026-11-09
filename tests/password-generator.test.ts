import { expect, test } from 'bun:test';
import { generatePassword, generatedPasswordLength, type PasswordRandomSource } from '../src/browser/password-generator';
function provider(fill: (array: Uint8Array) => void): PasswordRandomSource {
  return { getRandomValues: array => { fill(array as Uint8Array); return array; } };
}
test('generator uses exact-length unbiased alphabet mapping and erases its temporary bytes', () => {
  let retained: Uint8Array | undefined;
  const password = generatePassword(provider(bytes => {
    retained = bytes;
    bytes.set([0, 26, 52, 62, 63, 64, 90, 116, 126, 127]);
  }));
  expect(password.length).toBe(generatedPasswordLength);
  expect(password.startsWith('Aa0-_Aa0-_')).toBe(true);
  expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
  expect(retained!.every(byte => byte === 0)).toBe(true);
});
test('whole-candidate rejection meets all character classes and has a bounded failure path', () => {
  let calls = 0;
  const result = generatePassword(provider(bytes => {
    bytes.fill(0);
    if (++calls === 2) bytes.set([0, 26, 52, 62]);
  }));
  expect(calls).toBe(2); expect(result.slice(0, 4)).toBe('Aa0-');
  calls = 0;
  expect(() => generatePassword(provider(bytes => { calls++; bytes.fill(0); }))).toThrow();
  expect(calls).toBe(128);
});
test('unavailable or failed secure randomness never falls back to weaker randomness', () => {
  expect(() => generatePassword({} as Crypto)).toThrow();
  let retained: Uint8Array | undefined;
  expect(() => generatePassword(provider(bytes => { retained = bytes; bytes.fill(9); throw new Error('provider failed'); }))).toThrow('provider failed');
  expect(retained!.every(byte => byte === 0)).toBe(true);
});
