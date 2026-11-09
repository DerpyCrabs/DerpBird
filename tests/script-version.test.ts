import { expect, test } from 'bun:test';
import { compareScriptVersions } from '../src/browser/script-version';

test('numeric spelling and omitted zero components are equivalent', () => {
  for (const [a, b] of [['1', '1.0.0'], ['1.', '1'], ['16.04', '16.4'], ['1.12+1', '1.12+1.0'], ['2023-08-17_14-04', '2023-08-17_14-04.0']]) {
    expect(compareScriptVersions(a, b)).toBe(0);
    expect(compareScriptVersions(b, a)).toBe(0);
  }
});
test('numeric components, prereleases and dates have stable bidirectional ordering', () => {
  for (const [older, newer] of [
    ['Alpha-v2', 'Alpha-v10'], ['Alpha-v10', 'Beta'], ['Beta', '0.5pre3'],
    ['0.5pre3', '0.5prelimiary'], ['0.7pre4', '0.7pre10'], ['1.-1', '1'],
    ['1.1ab', '1.1b'], ['1.1c', '1.1.-1'], ['1.1.-1', '1.1'],
    ['1.1.1.1.1', '1.1.1.1.2'], ['1.1.1.1.2', '1.1.1.1'],
    ['1.9', '1.10'], ['1.10.0-alpha', '1.10'],
    ['1.11.0-alpha.1', '1.11.0-alpha+1'], ['1.12+4', '1.12'],
    ['2023-08-17.alpha', '2023-08-17'], ['2023-08-17', '2023-08-17_14-04'],
    ['2023-08-17_14-04', '2023-08-17+alpha'],
    ['2023-08-17+alpha', '2023-09-11_14-0'],
    ['9007199254740992', '9007199254740993'],
  ]) {
    expect(compareScriptVersions(older, newer)).toBeLessThan(0);
    expect(compareScriptVersions(newer, older)).toBeGreaterThan(0);
  }
});
