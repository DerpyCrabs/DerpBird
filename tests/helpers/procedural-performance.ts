import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const prelude = read('native/Resources/DerpBirdProceduralPrelude.js');
const upstream = read('third_party/ublock-resources/procedural/contentscript-extra.js');
const adapter = read('native/Resources/DerpBirdProceduralAdapter.js');
const runtime = read('native/Resources/DerpBirdProceduralRuntime.js');

// Real production executor and scheduler; deterministic frame/observer delivery.
// Counts describe algorithmic work. Happy DOM timings are not engine timings.
export function proceduralPerformanceFixture(count = 2000, ruleCount = 1, rules?: unknown[]) {
  const window = new Window({ url: 'https://example.com/' });
  const document = window.document;
  document.body.innerHTML = '<output id="clock"></output>' +
    Array.from({ length: count }, (_, i) => `<div class="card">Sponsored ${i}</div>`).join('');
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let nextId = 0;
  let deliver: (records: any[]) => void = () => {};
  let enabled = true;
  const metrics = { passes: 0, queries: 0, matchedNodes: 0, markerWrites: 0 };
  const originalSetAttribute = window.Element.prototype.setAttribute;
  window.Element.prototype.setAttribute = function(name, value) {
    if (name.startsWith('data-derpbird-')) metrics.markerWrites++;
    return originalSetAttribute.call(this, name, value);
  };
  const global = {
    __derpbirdAddCSS: () => true,
    __derpbirdFilterEnabled: () => enabled,
  };
  const instrument = `
    const Base = vAPI.DOMProceduralFilterer;
    vAPI.DOMProceduralFilterer = class extends Base {
      commitNow() { metrics.passes++; return super.commitNow(); }
      addProceduralSelectors(rules) {
        super.addProceduralSelectors(rules);
        for (const selector of this.selectors.values()) {
          if (selector.instrumented) continue;
          selector.instrumented = true;
          const exec = selector.exec;
          selector.exec = function(...args) {
            metrics.queries++;
            const nodes = exec.apply(this, args);
            metrics.matchedNodes += nodes.length;
            return nodes;
          };
        }
      }
    };
  `;
  const install = new Function('window', 'document', 'self', 'globalThis', 'crypto',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'metrics',
    prelude + upstream + adapter + instrument + runtime + '\nreturn __derpbirdInstallProcedural;')(
      window, document, window, global, crypto,
      class { constructor(callback: typeof deliver) { deliver = callback; } observe() {} },
      (callback: () => void) => { const id = ++nextId; frames.set(id, callback); return id; },
      (id: number) => frames.delete(id),
      (callback: () => void) => { const id = ++nextId; timers.set(id, callback); return id; },
      (id: number) => timers.delete(id), metrics);
  install((rules ?? Array.from({ length: ruleCount }, (_, i) => ({ selector: [
    { type: 'css-selector', arg: '.card' }, { type: 'has-text', arg: i === 0 ? 'Sponsored' : `NeverMatches${i}` },
  ] }))).map(rule => JSON.stringify(rule)));
  const flush = (queue: Map<number, () => void>) => {
    const callbacks = [...queue.values()]; queue.clear();
    for (const callback of callbacks) callback();
  };
  return {
    window, document, metrics,
    frame: () => flush(frames), fallback: () => flush(timers),
    pending: () => ({ frames: frames.size, timers: timers.size }),
    reset: () => { for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) metrics[key] = 0; },
    setEnabled: (value: boolean) => { enabled = value; },
    mutate: (attributeName = 'data-clock', target = document.getElementById('clock')!) =>
      deliver([{ type: 'attributes', attributeName, target }]),
    records: (records: any[]) => deliver(records),
    close: () => window.happyDOM.abort(),
  };
}
