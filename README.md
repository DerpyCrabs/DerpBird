# DerpBird

A desktop browser built on a Ladybird engine fork, with horizontal and vertical
tabs, pinned and child tabs, split views, workspaces, user styles and scripts,
and native MCP automation.

## Development checkout

This is currently a multi-repository workspace, not a standalone source release.
The engine fork referenced in `.gitmodules` must be accessible to the builder.
The following sibling source checkouts are also required by `package.json`:

```text
workspace/
  DerpBird/
  EffectWeb/       # packages/runtime, compiler, lucide, shadcn
  DerpDesign/      # packages/harness
```

These dependencies are source-workspace dependencies; replacing them with
registry versions requires confirming API compatibility. Obtain access to the
matching workspaces before installing. A public clone is not independently
buildable until the engine fork and these dependencies are publicly available
or replaced with reproducible public dependencies.

With Bun, Python 3, and the prerequisites from Ladybird's
[build instructions](https://github.com/LadybirdBrowser/ladybird/blob/master/Documentation/BuildInstructionsLadybird.md):

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bun run doctor
bun run build:engine
bun run start
```

The pinned engine is required. `scripts/prepare-engine.py` applies the native
overlays and checked-in patches; a modified engine working tree after a build
is expected. Do not replace the pin with upstream HEAD.

## Checks and demos

```sh
bun run check
bun run test
bun run test:demos
python3 -m unittest discover -s tests/build -v
```

Native UI tests use an owned headless Wayland compositor. Install `sway` and
`wtype` on PATH, or set `DERPBIRD_TEST_SWAY` to a custom sway executable.
`DERPBIRD_TEST_SWAYMSG` overrides `swaymsg` for shared-profile tests. Tests do
not require a particular desktop workspace; `DERPBIRD_TEST_WORKSPACE` optionally
checks an explicitly configured Hyprland workspace ID.

See [DerpDesign demos](demos/derpdesign/README.md) for interactive fixtures and
[Arch packaging](packaging/README.md) for installation instructions.

## Performance suite

```sh
bun run test:perf
bun run test:perf:reporting
```

The offline suite builds first, then runs native page, blocking, script/style,
layout, network/cache, resource, shell, desktop autocomplete, and component
workloads sequentially. It retains raw samples, correctness checks, CPU/RSS
samples, captures, and JSON/HTML reports. Saved complete reports can be compared
with `--compare`; no production optimizations are applied by the suite.

See [performance coverage, dependencies, and interpretation](tests/performance/README.md)
for the matrix, baseline rules, focused runs, and measurement limits.

## License

Original DerpBird code is licensed under MIT. Ladybird and derived files retain
BSD-2-Clause, and bundled components retain their own licenses, including MPL
and GPL. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Publication status

Local profiles, credentials, build outputs, downloaded research media, and
capture artifacts are excluded from source control. Git history still contains
author identities and earlier documentation paths; cleaning current files does
not erase earlier commits. Review those separately before publishing history.
