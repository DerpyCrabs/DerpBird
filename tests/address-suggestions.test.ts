import { expect, test } from 'bun:test';
import { suggestionDetails } from '../src/browser/address-suggestions';

test('suggestion labels do not duplicate search queries or alter navigation targets', () => {
  expect(suggestionDetails({ source: 'search', title: 'Zen browser', text: 'Zen browser' })).toBe('Search the web');
  const item = { source: 'history' as const, title: 'Docs', text: 'https://example.com/docs?q=one#part' };
  expect(suggestionDetails(item)).toBe('example.com/docs?q=one#part');
  expect(item.text).toBe('https://example.com/docs?q=one#part');
  expect(suggestionDetails({ source: 'settings', title: 'Choose an engine', text: 'about:settings', subtitle: 'to search for “hello”' })).toBe('to search for “hello”');
});
