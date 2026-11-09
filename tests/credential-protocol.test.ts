import { expect, test } from 'bun:test';
import { decodeCredential, decodeCredentials, validateCredentialDraft } from '../src/browser/credential-protocol';
const entry = { id: 'abc', origin: 'https://example.com', username: 'alice', revision: '9223372036854775807' };
test('metadata rejects secret fields, unsafe revisions, duplicate identities and noncanonical origins', () => {
  expect(decodeCredential(entry)).toEqual(entry);
  for (const revision of [1, '-1', '0', '01', '9223372036854775808']) expect(() => decodeCredential({ ...entry, revision })).toThrow();
  for (const origin of ['https://example.com/', 'https://user@example.com', 'https://EXAMPLE.com', 'data:text/html,x', 'https://example.com/path']) expect(() => decodeCredential({ ...entry, origin })).toThrow();
  expect(() => decodeCredential({ ...entry, password: 'must-not-be-in-list' })).toThrow();
  expect(() => decodeCredential({ ...entry, secret_id: 'internal' })).toThrow();
  expect(() => decodeCredentials({ items: [entry, entry] })).toThrow();
  expect(() => decodeCredentials({ items: Array(4097).fill(entry) })).toThrow();
});
test('save bounds UTF8 bytes and distinguishes create from update', () => {
  const draft = { ...entry, id: '', revision: '0', password: '\0binary-text' };
  expect(validateCredentialDraft(draft)).toEqual(draft);
  expect(() => validateCredentialDraft({ ...draft, username: 'я'.repeat(513) })).toThrow();
  expect(() => validateCredentialDraft({ ...draft, password: 'я'.repeat(32769) })).toThrow();
  expect(() => validateCredentialDraft({ ...draft, id: 'existing' })).toThrow();
  expect(() => validateCredentialDraft({ ...draft, revision: '1' })).toThrow();
});
