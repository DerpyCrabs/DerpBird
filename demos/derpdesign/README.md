# DerpBird demos

All DerpBird demo sources live here. They import the production shell, settings
entry, controllers, tab gestures, developer tools, proxy UI and styles from `src`.
Only native services and page content are fixtures. Unsupported fixture commands
fail explicitly; no browser profile or network configuration is changed.

Requires the sibling DerpDesign checkout for `@derpdesign/harness` (a local dev
dependency) and the `derpdesign` CLI. Run `bun install` in DerpBird first.

```sh
derpdesign session start --scale 1.6
bun demos/derpdesign/register.ts --session /path/to/session.json --port 47937 --activate derpbird-browser-layouts
# Execute checks through DerpDesign's sequence command, then stop the owned session.
derpdesign session stop --session /path/to/session.json
```

`bun demos/derpdesign/register.ts` registers all eight demos in the desktop
catalog, using port 47921. Updating its project closes an active DerpBird demo;
run this only when ready to replace that session, then select the desired demo.
The compatibility path in DerpDesign resolves here, so existing registrations
continue to use these sources without a catalog migration.

Available demos: shell, horizontal tabs, proxy profiles, proxy site controls,
split view, developer tools, integrated developer tools, and browser layouts.
The layout settings pane loads the same native Settings HTML and bundled source
entry as the product; its WebUI boundary feeds the fixture's saved preferences.

Tests: `bun test tests/layout-drag.test.ts tests/chrome-layout.test.ts
./demos/derpdesign/fixture.test.ts`, `bun run test:ui:dom`, and
`bun run test:shell:engine`, and `bun run test:layouts:engine` (requires the
isolated test compositor, `grim`, and `wtype`). JSON interaction checks use real Ladybird pointer and
keyboard input through DerpDesign. Native persistence and compositor geometry
are checked separately by the shipped engine suite.
