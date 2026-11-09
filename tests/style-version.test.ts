import { expect, test } from 'bun:test';
import { compareStyleVersions } from '../src/browser/style-version';

test('UserCSS version ordering preserves numeric precision and prerelease precedence', () => {
  for (const [a, b, order] of [
    ['1', '1.0.0', 0], ['v2026.01.02', '2026.1.2', 0],
    ['1.0.0+build.2', '1.0.0+build.1', 0], ['1.2.3.4.5', '1.2.3.4', 1],
    ['9007199254740993', '9007199254740992', 1],
    ['1.0-alpha.2', '1.0-alpha.10', -1], ['1.0-1', '1.0-alpha', -1],
    ['1.0-alpha', '1.0-alpha.1', -1], ['1.0-rc.1', '1.0', -1],
  ] as const) {
    expect(compareStyleVersions(a, b)).toBe(order);
    expect(compareStyleVersions(b, a)).toBe(order === 0 ? 0 : -order);
  }
});
