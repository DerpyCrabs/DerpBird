import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

test('history refreshes on return, preserves search, and rejects stale responses', () => {
  const html = readFileSync('vendor/ladybird/Base/res/ladybird/about-pages/history.html', 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  const window = new Window();
  try {
    const document = window.document;
    document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const requests: { requestId: number; offset: number; query: string }[] = [];
    Object.assign(window, { ladybird: { sendMessage: (name: string, data: typeof requests[number]) => {
      expect(name).toBe('loadHistoryEntries');
      requests.push(data);
    } } });
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => visibility });
    const changeVisibility = (value: string) => {
      visibility = value;
      document.dispatchEvent(new window.Event('visibilitychange'));
    };
    window.eval(script!);
    changeVisibility('visible');
    expect(requests).toHaveLength(0);
    document.dispatchEvent(new window.Event('WebUILoaded'));
    expect(requests).toHaveLength(1);
    const search = document.querySelector('#history-search') as unknown as HTMLInputElement;
    search.value = 'example';
    changeVisibility('hidden');
    expect(requests).toHaveLength(1);
    changeVisibility('visible');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ offset: 0, query: 'example' });
    const respond = (requestId: number, title: string) => document.dispatchEvent(new window.CustomEvent('WebUIMessage', {
      detail: { name: 'loadHistoryEntries', data: { requestId, query: 'example', offset: 0, hasMore: false,
        entries: [{ title, url: 'https://example.com/', lastVisitedTime: Date.now(), visitCount: 1 }] } },
    }));
    respond(requests[1].requestId, 'Fresh visit');
    expect(document.querySelector('#history-groups')!.textContent).toContain('Fresh visit');
    respond(requests[0].requestId, 'Stale visit');
    expect(document.querySelector('#history-groups')!.textContent).not.toContain('Stale visit');
    changeVisibility('hidden');
    changeVisibility('visible');
    expect(requests[2]).toMatchObject({ offset: 0, query: 'example' });
    expect(search.value).toBe('example');
  } finally {
    window.happyDOM.abort();
  }
});
