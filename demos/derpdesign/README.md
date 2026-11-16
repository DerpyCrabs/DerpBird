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

## Workspace and pin design

`derpbird-workspaces` covers all eight existing browser layouts, two Default-only
states, and workspace creation/editing. The existing shell and example page keep
their original styling and dimensions.

Workspace icons appear once: at the bottom of a vertical tab sidebar, or at the
end of a horizontal tab strip. The only workspace being Default hides the entire
control. Create another from the browser menu. Click an icon to switch, right-click
to edit its name/icon/color, and use + to create a workspace.

Pinned tabs are compact icon tiles, using the normal tabs' square
corners, hover and selected states. Site icons and accessible names identify them;
the normal tab context menu pins/unpins. Additional pins wrap to a new row, with at most six per row.

Workspaces and pins render through the production Shell and Workspaces components,
using the production controller and command protocol. Only native services and page
content are replaced by fixtures. The desktop persists workspace metadata and tab
membership alongside its session; account containers are not part of this feature. Reference:
https://docs.zen-browser.app/user-manual/workspaces

Run `workspace-checks.json` and `workspace-create-checks.json` with the isolated
DerpDesign sequence runner. `workspace-default-checks.json` verifies the hidden
Default controls and creation of the first additional workspace. Publish the demo
with `bun demos/derpdesign/publish-workspaces.ts`.

Nine-pin scenarios (`workspace-nine-sidebar`, `workspace-nine-compact`, and
`workspace-nine-classic`) wrap pins into a grid with at most six columns. Nine pins
use 6 + 3 at the default width. Narrow sidebars use fewer columns so icons retain
their click targets. There is no dedicated scrolling pin strip. The horizontal tab
area grows with additional pin rows. `workspace-nine-checks.json` and
`workspace-nine-horizontal-checks.json` capture the first and ninth selection.

`bun run test:workspaces:engine` builds the real browser and checks creation through
the form, workspace isolation, nine pins, keyboard cycling, last-tab closure,
restart persistence and private-window non-persistence on an isolated compositor.
