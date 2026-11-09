import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';

const root = new URL('../', import.meta.url);
const upstream = readFileSync(new URL('third_party/ublock-resources/procedural/contentscript-extra.js', root), 'utf8');
const adapter = readFileSync(new URL('native/Resources/DerpBirdProceduralAdapter.js', root), 'utf8');
const checksums = JSON.parse(readFileSync(new URL('third_party/ublock-resources/PROCEDURAL_SHA256SUMS.json', root), 'utf8'));

function fixture() {
  const window = new Window({ url: 'https://example.com/news' });
  let sequence = 0;
  const api: any = { randomToken: () => 'data-procedural-' + ++sequence, hideStyle: 'display:none!important;' };
  const adapterAPI = new Function('window', 'document', 'self', 'vAPI',
    upstream + '\n' + adapter + '\nreturn { convert: derpbirdProceduralRule, register: derpbirdRegisterProceduralTasks };')(window, window.document, window, api);
  const facade = {
    commit() {}, hasListeners: () => false,
    addCSS(css: string) {
      const style = window.document.createElement('style');
      style.textContent = css;
      window.document.head.appendChild(style);
    },
  };
  const filterer = new api.DOMProceduralFilterer(facade);
  adapterAPI.register(filterer);
  const convert = adapterAPI.convert;
  return { window, document: window.document, convert, filterer };
}
const css = (arg: string) => ({ type: 'css-selector', arg });

test('procedural executor source matches its pinned digest', () => {
  expect(createHash('sha256').update(upstream).digest('hex')).toBe(checksums['procedural/contentscript-extra.js']);
});

test('translated rules select text, ancestors, CSS paths and attributes in the upstream executor', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<section id="one"><div class="card" data-kind="sponsor"><span>Sponsored</span></div></section><section id="two"><div class="card">Article</div></section>';
  const select = (selector: any[]) => filterer.createProceduralFilter(convert({ selector })).exec();
  expect(select([css('.card'), { type: 'has-text', arg: 'Sponsored' }, { type: 'upward', arg: '1' }]).map((n: any) => n.id)).toEqual(['one']);
  expect(select([css('.card'), { type: 'matches-attr', arg: 'data-kind=sponsor' }])).toHaveLength(1);
  expect(select([css('section'), { type: 'has-text', arg: '/sponsored/i' }, css('span')])[0].textContent).toBe('Sponsored');
  expect(select([css('.card'), { type: 'min-text-length', arg: '8' }])).toHaveLength(1);
  expect(select([css('.card'), { type: 'matches-path', arg: '/news' }])).toHaveLength(2);
});

test('upstream executor hides and restores changed matches and applies removal actions', () => {
  const { document, window, convert, filterer } = fixture();
  document.body.innerHTML = '<div id="ad">Sponsored</div><div id="remove">Delete</div><div id="attr" data-ad="1" class="advert">Keep</div>';
  filterer.addProceduralSelectors([
    convert({ selector: [css('#ad'), { type: 'has-text', arg: 'Sponsored' }] }),
    convert({ selector: [css('#remove')], action: { type: 'remove' } }),
    convert({ selector: [css('#attr')], action: { type: 'remove-attr', arg: 'data-ad' } }),
    convert({ selector: [css('#attr')], action: { type: 'remove-class', arg: 'advert' } }),
  ]);
  filterer.commitNow();
  const ad = document.getElementById('ad')!;
  expect(window.getComputedStyle(ad).display).toBe('none');
  expect(document.getElementById('remove')).toBeNull();
  expect(document.getElementById('attr')!.hasAttribute('data-ad')).toBe(false);
  expect(document.getElementById('attr')!.className).toBe('');
  ad.textContent = 'Editorial';
  filterer.commitNow();
  expect(window.getComputedStyle(ad).display).not.toBe('none');
});

test('malformed operators reject the complete rule', () => {
  const { convert } = fixture();
  for (const op of [
    { type: 'unknown', arg: 'x' }, { type: 'upward', arg: '0' },
    { type: 'min-text-length', arg: '1.5' }, { type: 'matches-css', arg: 'missing colon' },
    { type: 'matches-attr', arg: '' },
  ]) expect(() => convert({ selector: [css('*'), op] })).toThrow();
  expect(() => convert({ selector: [css('*')], action: { type: 'unknown' } })).toThrow();
});

test('removal patterns remove every adjacent match and retain unrelated names', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<div id="target" data-ad-one="1" data-ad-two="2" data-keep="3" class="ad-one ad-two keep ad-three literal.dot literalXdot"></div>';
  filterer.addProceduralSelectors([
    convert({ selector: [css('#target')], action: { type: 'remove-attr', arg: '/^data-ad-/i' } }),
    convert({ selector: [css('#target')], action: { type: 'remove-class', arg: '"/^ad-/"' } }),
    convert({ selector: [css('#target')], action: { type: 'remove-class', arg: "'literal.dot'" } }),
  ]);
  filterer.commitNow();
  const target = document.getElementById('target')!;
  expect(target.getAttributeNames().sort()).toEqual(['class', 'data-keep', 'id']);
  expect(target.className).toBe('keep literalXdot');
  target.classList.add('ad-four', 'ad-five');
  target.setAttribute('data-ad-new', '1');
  filterer.commitNow();
  expect(target.className).toBe('keep literalXdot');
  expect(target.hasAttribute('data-ad-new')).toBe(false);
});

test('invalid removal patterns are rejected before admission to the executor', () => {
  const { convert } = fixture();
  for (const type of ['remove-attr', 'remove-class']) {
    for (const arg of ['', ' ', '""', '/[/', '/x/g', '/x/ii', '/unclosed', '"unclosed', '"x"tail', 'x'.repeat(16385)]) {
      expect(() => convert({ selector: [css('*')], action: { type, arg } })).toThrow();
    }
  }
});

test('property predicates use the pinned executor for existence, values and nested paths', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<input id="one" type="checkbox" checked><input id="two" type="checkbox"><div id="three"></div>';
  const select = (arg: string) => filterer.createProceduralFilter(convert({
    selector: [css('input, div'), { type: 'matches-prop', arg }],
  })).exec().map((node: any) => node.id);
  expect(select('checked')).toEqual(['one', 'two']);
  expect(select('checked=true')).toEqual(['one']);
  expect(select('"checked"="false"')).toEqual(['two']);
  expect(select('nodeName=/^INPUT$/')).toEqual(['one', 'two']);
  expect(select('classList.length=0')).toEqual(['one', 'two', 'three']);
  expect(select('missing.child')).toEqual([]);
  expect(() => select('classList..length')).toThrow();
});

test('quoted operands and CSS equality retain upstream matching semantics', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<div id="first" class="card" data-kind="sponsor" style="display:inline-block">Sponsored</div><div id="second" class="card" style="display:block">Story</div>';
  const select = (operator: any) => filterer.createProceduralFilter(convert({ selector: [css('.card'), operator] })).exec().map((node: any) => node.id);
  expect(select({ type: 'has-text', arg: '"Sponsored"' })).toEqual(['first']);
  expect(select({ type: 'matches-attr', arg: '"data-kind"="sponsor"' })).toEqual(['first']);
  expect(select({ type: 'matches-attr', arg: '"data-kind=sponsor"' })).toEqual(['first']);
  expect(select({ type: 'matches-css', arg: 'display: block' })).toEqual(['second']);
  expect(select({ type: 'matches-css', arg: 'display: /block$/' })).toEqual(['first', 'second']);
  expect(() => convert({ selector: [css('*'), { type: 'has-text', arg: '"unfinished' }] })).toThrow();
  expect(() => convert({ selector: [css('*'), { type: 'upward', arg: '256' }] })).toThrow();
});

test('embedded runtime coalesces mutation batches and becomes idle after its own writes', async () => {
  const window = new Window({ url: 'https://example.com/' });
  const document = window.document;
  document.body.innerHTML = '<div class="card">Sponsored</div>';
  const jobs: (() => void)[] = [];
  const timers = new Set<() => void>();
  let enabled = true;
  (window as any).__derpbirdFilterEnabled = () => enabled;
  (window as any).__derpbirdAddCSS = (css: string) => {
    const node = document.createElement('style');
    node.textContent = css;
    document.head.appendChild(node);
    return true;
  };
  const prelude = readFileSync(new URL('native/Resources/DerpBirdProceduralPrelude.js', root), 'utf8');
  const runtime = readFileSync(new URL('native/Resources/DerpBirdProceduralRuntime.js', root), 'utf8');
  const install = new Function('window', 'document', 'self', 'globalThis', 'crypto', 'MutationObserver',
    'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
    prelude + '\n' + upstream + '\n' + adapter + '\n' + runtime + '\nreturn __derpbirdInstallProcedural;'
  )(window, document, window, window, window.crypto, window.MutationObserver,
    (job: () => void) => { timers.add(job); return job; },
    (job: () => void) => timers.delete(job),
    (job: () => void) => { jobs.push(job); return job; },
    (job: () => void) => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); });

  install([JSON.stringify({ selector: [css('.card'), { type: 'watch-attr', arg: 'class, data-ad' }, { type: 'has-text', arg: 'Sponsored' }] })]);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  expect(jobs).toHaveLength(1);
  jobs.shift()!();
  await tick();
  expect(window.getComputedStyle(document.querySelector('.card')!).display).toBe('none');
  // First stylesheet insertion can schedule one follow-up; marker writes cannot.
  if (jobs.length) { jobs.shift()!(); await tick(); }
  expect(jobs).toHaveLength(0);
  for (let i = 0; i < 200; i++) {
    const node = document.createElement('div');
    node.className = 'card';
    node.textContent = 'Sponsored';
    document.body.appendChild(node);
  }
  await tick();
  expect(jobs).toHaveLength(1);
  jobs.shift()!();
  await tick();
  expect(jobs).toHaveLength(0);
  expect(window.getComputedStyle(document.body.lastElementChild!).display).toBe('none');
  enabled = false;
  const disabledNode = document.createElement('div');
  disabledNode.className = 'card';
  disabledNode.textContent = 'Sponsored';
  document.body.appendChild(disabledNode);
  await tick();
  expect(jobs).toHaveLength(1);
  jobs.shift()!();
  await tick();
  expect(window.getComputedStyle(disabledNode).display).not.toBe('none');
  expect(jobs).toHaveLength(0);
  expect(timers.size).toBe(0);
  enabled = true;
  disabledNode.textContent = 'Sponsored again';
  await tick();
  expect(jobs).toHaveLength(1);
  expect(timers.size).toBe(1);
  // Simulate an invisible document whose animation frame never fires.
  const fallback = [...timers][0];
  timers.delete(fallback);
  fallback();
  await tick();
  expect(jobs).toHaveLength(0);
  expect(timers.size).toBe(0);
  expect(window.getComputedStyle(disabledNode).display).toBe('none');
  await window.happyDOM.close();
});


test('media conditions and others use upstream selection semantics', () => {
  const { window, document, convert, filterer } = fixture();
  document.body.innerHTML = '<main><div id="keep">Article</div><div id="discard">Ad</div></main><aside id="aside">Ad</aside>';
  let matches = false;
  (window as any).matchMedia = () => ({ media: '(min-width: 600px)', get matches() { return matches; }, addEventListener() {} });
  const rule = filterer.createProceduralFilter(convert({ selector: [css('#keep'), { type: 'matches-media', arg: '(min-width: 600px)' }, { type: 'others', arg: '' }] }));
  expect(rule.exec()).toHaveLength(0);
  matches = true;
  expect(rule.exec().map((node: any) => node.id).sort()).toEqual(['aside', 'discard']);
  expect(() => convert({ selector: [css('*'), { type: 'others', arg: 'unexpected' }] })).toThrow();
  expect(() => convert({ selector: [css('*'), { type: 'matches-media', arg: '' }] })).toThrow();
});

test('nested conditions compose without broadening rejected inner rules', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<section id="ad"><div><span>Sponsored</span></div></section><section id="news"><div><span>Article</span></div></section>';
  const condition = [css('div'), { type: 'has', arg: [css('> span'), { type: 'has-text', arg: 'Sponsored' }] }];
  const select = (type: string) => filterer.createProceduralFilter(convert({ selector: [css('section'), { type, arg: condition }] })).exec().map((node: any) => node.id);
  expect(select('has')).toEqual(['ad']);
  expect(select('if')).toEqual(['ad']);
  expect(select('if-not')).toEqual(['news']);
  expect(() => convert({ selector: [css('section'), { type: 'has', arg: [css('span'), { type: 'unknown', arg: '' }] }] })).toThrow();
  let nested: any[] = [css('span')];
  for (let i = 0; i < 34; ++i) nested = [{ type: 'has', arg: nested }];
  expect(() => convert({ selector: nested })).toThrow();
});


test('selector unions deduplicate and procedural negation matches candidate elements', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<main><article id="ad">Sponsored</article><article id="news">Editorial</article></main>';
  const union = { type: 'any', arg: [[css('article'), { type: 'has-text', arg: 'Sponsored' }], [css('#ad')]] };
  expect(filterer.createProceduralFilter(convert({ selector: [union] })).exec().map((n: any) => n.id)).toEqual(['ad']);
  const negative = convert({ selector: [css('article'), { type: 'not', arg: [{ type: 'any', arg: [[{ type: 'has-text', arg: 'Editorial' }]] }] }] });
  const rule = filterer.createProceduralFilter(negative);
  expect(rule.exec().map((n: any) => n.id)).toEqual(['ad']);
  document.getElementById('ad')!.textContent = 'Editorial';
  expect(rule.exec()).toHaveLength(0);
  // The negative branch's CSS prefix describes its actual subject, not a child
  // of the candidate being filtered.
  const complex = convert({ selector: [css('article'), { type: 'not', arg: [css('main > article'), { type: 'has-text', arg: 'Editorial' }] }] });
  expect(filterer.createProceduralFilter(complex).exec()).toHaveLength(0);
  expect(() => convert({ selector: [{ type: 'any', arg: [] }] })).toThrow();
});

test('nested negation scans once per commit and refreshes after DOM changes', () => {
  const { document, window, convert, filterer } = fixture();
  document.body.innerHTML = '<section><span class="negation-probe">Ad</span></section>'.repeat(200);
  const query = document.querySelectorAll.bind(document);
  let scans = 0;
  (document as any).querySelectorAll = (selector: string) => {
    if (selector === '.negation-probe') ++scans;
    return query(selector);
  };
  filterer.addProceduralSelectors([convert({ selector: [css('section'), { type: 'has', arg: [css('span'), { type: 'not', arg: [css('.negation-probe'), { type: 'has-text', arg: 'Keep' }] }] }] })]);
  filterer.commitNow();
  expect(scans).toBe(1);
  expect(window.getComputedStyle(document.querySelector('section')!).display).toBe('none');
  for (const node of query('.negation-probe')) node.textContent = 'Keep';
  filterer.commitNow();
  expect(scans).toBe(2);
  expect(window.getComputedStyle(document.querySelector('section')!).display).not.toBe('none');
});

test('positive membership and CSS suffixes keep the selected subject', () => {
  const { document, convert, filterer } = fixture();
  document.body.innerHTML = '<div id="yes" class="eligible">Sponsored<b id="child"></b></div><div id="no">Sponsored<b class="eligible"></b></div>';
  const select = (selector: any[]) => filterer.createProceduralFilter(convert({ selector })).exec().map((n: any) => n.id);
  expect(select([css('div'), { type: 'matches', arg: [css('#yes'), { type: 'has-text', arg: 'Sponsored' }] }])).toEqual(['yes']);
  expect(select([css('div'), { type: 'has-text', arg: 'Sponsored' }, { type: 'matches-selector', arg: '.eligible' }])).toEqual(['yes']);
  expect(select([css('div'), { type: 'has-text', arg: 'Sponsored' }, { type: 'matches-selector', arg: '.eligible' }, css(' > b')])).toEqual(['child']);
});
