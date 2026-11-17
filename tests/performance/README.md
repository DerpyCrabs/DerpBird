# Performance suite

Run `bun run test:perf` from the repository root. This builds the selected engine,
its native harness, the shipped UI, and component benchmarks before running the
whole matrix **sequentially**. No production optimizations are part of this suite.

The default is one discarded warmup and five measured samples per scenario.
Each native scenario runs in a separate process and disposable profile against
an ephemeral loopback HTTP server. No external websites or personal browser
profiles are used. Settings, filters, styles, scripts, DOM contents, and viewport
size are specified by the fixtures.

## Commands

```sh
# Inspect the native scenario matrix.
bun run test:perf --list

# Full suite: 53 native scenarios plus four additional benchmark groups.
bun run test:perf --output artifacts/performance-before

# A longer baseline, suitable for investigating distributions.
bun run test:perf --samples 30 --warmups 3 --output artifacts/performance-release

# Compare a later complete run against a saved report.
bun run test:perf --compare artifacts/performance-before/report.json \
  --output artifacts/performance-after

# Focused diagnostics; explicitly marked as partial, not usable as a baseline.
bun run test:perf --scenario procedural-20-attributes --samples 2

# Harness/reporting tests.
bun run test:perf:reporting
bun test tests/procedural-performance.test.ts tests/procedural-filter-adapter.test.ts
```

The desktop layer requires `sway`, `wtype`, `grim`, and Python Pillow, in addition
to the normal browser build prerequisites. Set `DERPBIRD_TEST_SWAY` to an alternate
Sway executable when needed. It creates its own headless Wayland compositor and
profile, with remote search suggestions disabled. A missing desktop dependency
fails the complete run; it is not silently skipped. The compositor uses pixman,
so desktop results do not describe hardware GPU performance.

`--no-build` is available for diagnostics only. It marks the report incomplete;
stale native test binaries can be ABI-incompatible with rebuilt engine libraries.
Do not reuse an output directory containing `report.json`.

## Coverage

| Area | Workloads and correctness checks |
| --- | --- |
| Navigation | Empty, 2,000-card and 10,000-card pages; 20 repeated navigations; loaded DOM and expected script/style effects |
| DOM | Batched insertion/removal; attribute, text, and class churn; resulting node counts and values |
| Layout/compositing | Repeated layout reads after width changes; RAF animation; scrolling; viewport PNG capture; nonzero geometry and actual movement |
| Images/canvas | 32 distinct local PNG loads; dimensions; 10,000 canvas draws and pixel readback |
| JavaScript/platform | JSON/array work with checksum; localStorage writes/reads/removal; worker message round trip; shadow DOM layout; eight same-origin frames |
| Network/cache | 32-resource batches; cold and warm cache; server-side counts verify cache hits and that blocked requests never reach the server |
| Blocking | Disabled controls; cosmetic CSS; 1 and 20 procedural rules under three mutation types; 1,000 and 10,000 network rules for allowed and blocked traffic |
| User styles/scripts | 100/1,000 installed style sections, including history URL churn; 10/50 isolated document-start scripts with execution counts |
| Tabs/resources | One/eight real content views, inactive views hidden; idle CPU sampling; process-tree RSS after load and peak RSS |
| Shipped shell | Vertical/horizontal layouts with 10/100/500 tab records; snapshot changes, resizing, tab scrolling, pin/unpin animation, idle, and 100 real WebUI round trips; tab counts, titles and viewport geometry |
| Native desktop | Real Qt URL-bar input → suggestion DOM → next RAF, with local autocomplete IPC; stable geometry, keyboard selection and pointer dismissal; captures retained |
| Components | Repeated style URL/regex matching, pathological-regex guards, userscript value-store reads/writes/bulk snapshots, procedural work counts |

Every native sample must emit one valid result with the expected scenario,
index, warmup flag, finite metrics and successful correctness checks. Missing,
duplicate, failed, malformed, or timed-out samples fail the run. Crash/timeout
cleanup kills the owned process group; logs remain available.

## Reports and comparisons

The output directory contains:

- `report.json`: revisions, dirty-tree status, fixture fingerprint, machine/build
  compatibility, raw samples, summaries, failures, and baseline regressions.
- `report.html`: portable overview; open it directly, without a server.
- Per-scenario `output.log`, `processes.json`, and `phases.json`.
- `capture-viewport/capture-*.png` and desktop interaction captures.
- Per-component/per-repetition raw logs, including warmups.

Native summaries report median, p95, minimum, maximum, and median absolute
 deviation (MAD). A five-sample p95 is the maximum of five runs, not a reliable
estimate of the population tail. Use more samples for a release baseline.
Native scenario order is fixed and profiles isolated; comparing complete runs
on the same idle machine is preferable to inferring causality from two different
scenarios in one run.

Comparisons require successful complete baselines, identical scenario/metric
sets, fixture fingerprint, CPU, kernel, affinity, build path, and sample counts.
A timing regression must exceed **both 20% and 2 ms** in median, configurable with
`--relative-threshold` and `--absolute-threshold-ms`. RSS medians use a 16 MiB
absolute floor; idle CPU uses two percentage points, also requiring the relative
threshold. Regressions cause a nonzero exit status. Sub-millisecond component
changes are recorded but will not trip the default 2 ms floor. Baselines are
explicit report files: the runner never automatically accepts new timings.

## Interpretation boundaries

- `viewReadyMs` includes view creation and an `about:blank` load; it may reuse the
  engine process pool. It is not a cold browser-launch measurement.
- `navigationMs` covers native load initiation through `on_load_finish`, including
  local HTTP, parsing, styles and scripts. `navigation-churn` measures 20 loads.
  No internet DNS/TLS or remote-server latency is included.
- `elapsedMs` is the workload duration; mutation/idle workloads include intentional
  waits. Heartbeat gaps expose event-loop stalls. RAF intervals measure callback
  delivery, not presented FPS. Capture timing includes screenshot encoding/I/O.
- Shell native scenarios use fixture tab services; the separate desktop group
  exercises Qt and real autocomplete. Neither reports hardware input-to-photon
  latency. Media/video decoding and hardware GPU throughput are outside this
  offline suite's coverage.
- Aggregate RSS double-counts shared pages. CPU sampling can miss short-lived
  children. Idle CPU uses only full sampling intervals inside the idle workload;
  overall CPU/peak RSS include setup. `postLoadRssMiB` is sampled when the runner
  receives the workload-start marker, not an exact synchronized heap snapshot.
  These metrics can flag growth; they do not prove a memory leak.
- Happy DOM work counts execute the production procedural JS with controlled
  frame/observer delivery. Its wall time is diagnostic and never a native timing
  gate. Marker writes count `setAttribute` attempts, including no-op writes.

The suite defines a reproducible offline regression contract, not exhaustive
coverage of every browser API or every website. Extend the versioned workload
matrix when a new feature or a real-site regression exposes a missing case.

## Daily-use responsiveness gates

A normal run now applies absolute guardrails without requiring `--compare`:
100 history updates with 1,000 styles must stay below 100 ms median total and
maximum-heartbeat-gap; procedural workloads below 50 ms median maximum gap;
shell snapshot update p95 below 50 ms for 10/100 tabs and 100 ms for the 500-tab
stress case; desktop autocomplete input-to-next-RAF below 50 ms median.
These are coarse responsiveness limits, not 60 FPS or input-to-photon guarantees.
The median is taken across runs; use at least 30 samples when investigating tails.
The procedural component also requires exactly zero passes, selector executions,
and marker-write attempts for unrelated attribute mutations. Correctness tests
retain relevant-attribute invalidation, match removal, marker repair, and URL
scope entry/exit after user-style caching.


Shell workloads also record `geometryReads` (getBoundingClientRect calls) and
`createdElements` (createElementNS calls) during the measured interaction.
The 500-tab scroll case alternates scroll positions; the pin case waits for each
of six pin/unpin animations to finish and checks the resulting tab placement.
Pin duration includes the intentional 280 ms animation and is not a pure CPU
measurement. Captures are retained for both cases. Compare work counts as well
as time when changing animation bookkeeping.
