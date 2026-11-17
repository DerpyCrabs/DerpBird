import { proceduralPerformanceFixture } from '../tests/helpers/procedural-performance';

// Deterministic workload counts, not a substitute for native rendering timings.
for (const count of [200, 2000]) {
  for (const ruleCount of [1, 20]) {
    const f = proceduralPerformanceFixture(count, ruleCount);
    try {
      f.frame(); f.reset();
      const started = performance.now();
      for (let frame = 0; frame < 30; frame++) {
        f.document.getElementById('clock')!.setAttribute('data-clock', String(frame));
        f.mutate(); f.frame();
      }
      if (f.metrics.passes !== 0 || f.metrics.queries !== 0 || f.metrics.markerWrites !== 0)
        throw new Error('Unrelated attributes must not trigger procedural filtering');
      console.log(JSON.stringify({ workload: 'unrelated-attribute-30-frames', count, ruleCount,
        ...f.metrics, harnessMs: performance.now() - started }));
    } finally { await f.close(); }
  }
}
