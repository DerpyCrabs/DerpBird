# Browser UI research and implementation

DerpDesign demo `derpbird-haz-tabs`: **DerpBird · browser UI**.
Fourteen real Ladybird panes: tab reference at 640 and 360 px and 2× density,
horizontal and vertical browser shells, settings at 1040 and 440 px, a modal, parent/child groups in both orientations, two split-view scenarios, compact chrome, and a live gallery of 1–10 pins.
Neutral charcoal replaces the previous green styling. Browser panes import the
existing shell/controller/gestures; they are not static drawings.

## Research reviewed

Research used DerpBird's shared-login background browser, the author's recent
profile posts, targeted dialog searches, and the live Ariakit dialog example.
Nine videos were downloaded and reviewed as contact sheets sampled every two
seconds across their full timelines. This is visual frame review, not a claim of
listening to narration or watching every frame. Downloaded videos and contact sheets are local research artifacts, excluded
from this repository. Public source links are listed below.

| Source | Observations applied |
| --- | --- |
| [Scrollable tabs](https://x.com/diegohaz/status/2122396486835020227), 64 s | Fade only overflowing edges; retain an inert endpoint under the hovered chevron; keep keyboard focus clear of controls and fades. |
| [Hybrid pointer reply](https://x.com/diegohaz/status/2122407499869589599) | Use `any-pointer: fine` so a touchscreen laptop with a mouse still gets controls. |
| [Tab anatomy](https://x.com/diegohaz/status/2122014119511703753), 40 s | Continuous tab/panel silhouette, inverse lower corners, quiet separators that disappear beside active/hovered tabs. |
| [UI details](https://x.com/diegohaz/status/2121696559955919147), 65 s | Consistent icon/text alignment, whole-row hover, clear accessible names and descriptions, restrained disclosure. |
| [Form layout](https://x.com/diegohaz/status/2116348857781260557), 75 s | Group label and field as a row: 12 px internal spacing, larger 28 px separation between rows, content-sized label column and subgrid. Helpers/errors belong with their input. |
| [Nested corners](https://x.com/diegohaz/status/2117004745047228730), 62 s | Tight nesting uses outer radius minus inset and border (12−4−1=7). Roomy dialogs retain practical control radii rather than applying that formula mechanically. |
| [Checkbox detail](https://x.com/diegohaz/status/2117930076243185814), 36 s | Give the control boundary sufficient contrast without bleaching the entire fill; distinguish hover/checked/disabled states. |
| [Text fields](https://x.com/diegohaz/status/2114406485077721446), 42 s | Clear labels, slots, helpers and error states; maintain boundaries on different backgrounds. |
| [List details](https://x.com/diegohaz/status/2120859335597216202), 60 s | Consistent marker/text inset and deliberate guide continuity. Avoid ornamental guide clutter in the browser adaptation. |
| [Design details](https://x.com/diegohaz/status/2121266830912479614), 40 s | Align nested rows and guides, give controls coherent contrast and spacing. |

Related dialog posts: [Dialog + Combobox](https://x.com/diegohaz/status/1750860895842947376),
[nested dropdown Escape handling](https://x.com/diegohaz/status/1711146282763288710),
[nested dialogs](https://x.com/diegohaz/status/1725789858826703252), and
[top-layer control limitations](https://x.com/diegohaz/status/1936504642344456480).
The [live Ariakit dialog](https://ariakit.org/examples/dialog) was opened and
closed with Escape, verifying focus returned to its trigger. These support the
interaction direction; the modal here uses DerpBird's existing `ShellDialog`.

No specific vertical browser-tab design by Haz was established. The sidebar,
settings information architecture, and workspace form are our adaptations of
these principles, not designs attributed to him.

## Implementation

- The tab reference uses one continuous SVG outline behind real DOM tab buttons
  and the panel. It updates from measured tab/scroll geometry. The same outline now drives the actual horizontal browser tabs, including
  a 240 ms selection transition. There are no overlapping background patches
  cutting holes at the corner joins.
- Overflow masks affect only the scrolling list. Chevron buttons sit outside
  the mask, skip sequential keyboard focus, and remain inert beneath a stationary
  pointer at the endpoint. Arrow keys/Home/End keep the active tab visible.
  Scroll/resize/mutation observers substitute for scroll timelines in Ladybird.
  Chevron movement uses an interruptible 280 ms animation; ordinary vertical
  mouse-wheel input is mapped to horizontal scrolling. Horizontal trackpad
  deltas remain direct. Reduced motion skips both animations. Vertical browser
  lists use a thin native scrollbar and an 18 px edge fade, not floating arrow buttons.
- The browser proposal uses neutral surfaces, aligned favicon/title/action slots,
  visible close actions, with an optional quiet mode in settings, consistent
  menu corners, and a restrained address palette. Both tab orientations remain.
- Settings include Appearance, Tabs & navigation, and Workspaces. They reuse the
  production layout chooser and controller actions for layout, wrapping, sidebar
  width, workspace switching and renaming. Narrow settings use vertical fields
  and a horizontal category strip.
- `src/ui/PreferencesPrimitives.tsx` provides opt-in reusable sections, labeled
  fields, checkboxes and dialogs. Styles are scoped by `.preferences-theme`. Shared grid tracks with
  `display: contents` preserve the form alignment in Ladybird, where the tested
  subgrid layout did not align this field correctly.
  Dialogs have associated title/description, initial field focus, Escape dismissal,
  focus restoration, inline validation, and independent light/dark theme styling.
  The Overlay API now accepts ARIA naming and a callback for initial focus and explicit focus restoration.

## Limits

This is a working DerpDesign proposal, not a deployment to the installed browser.
Native services use the deterministic fixture and settings are session-local.
The theme applies to the proposal; it is not an OS/theme integration. Pins still
scroll with the existing tab list. Keeping pins fixed and adding a searchable tab
switcher remain possible follow-ups, not implemented claims. Physical touch and
native compositor behavior have not been validated. The tab anatomy is a measured
reproduction of the principle, not a claim of pixel-identical source geometry.

## Reproduce verification

```sh
derpdesign session start --scale 1
bun demos/derpdesign/haz-tabs/register.ts /absolute/session.json
derpdesign sequence --session /absolute/session.json --pane haz-reference --file demos/derpdesign/haz-tabs/reference-checks.json --out /tmp/reference-report.json
# Repeat geometry at haz-reference-density:
derpdesign sequence --session /absolute/session.json --pane haz-reference-narrow --file demos/derpdesign/haz-tabs/geometry-checks.json --out /tmp/geometry-report.json
derpdesign sequence --session /absolute/session.json --pane haz-horizontal --file demos/derpdesign/haz-tabs/shell-checks.json --out /tmp/shell-report.json
derpdesign sequence --session /absolute/session.json --pane haz-vertical --file demos/derpdesign/workspace-checks.json --out /tmp/workspace-report.json
derpdesign sequence --session /absolute/session.json --pane haz-vertical --file demos/derpdesign/layout-drag-checks.json --out /tmp/drag-report.json
derpdesign sequence --session /absolute/session.json --pane haz-settings --file demos/derpdesign/haz-tabs/settings-checks.json --out /tmp/settings-report.json
derpdesign session stop --session /absolute/session.json
```

Reset panes between sequences when needed. Registration uses isolated port 47947.
Publish the same demo ID to the existing desktop catalog without selecting it:
`bun demos/derpdesign/haz-tabs/register.ts`.

## Hover, pins, and control layout correction

Hover backgrounds now paint inside fixed tab geometry: neither the hit target
nor the label moves on entry. Horizontal separators disappear on both sides of
hovered/active tabs, accounting for the actual tab-unit wrappers. Horizontal pins use the same connected active contour and inset hover as other tabs, with the title omitted. Sidebar pins are rounded tiles that fill balanced rows. The sidebar keeps its scrollbar flush to the sidebar edge. Rows have a 6 px inset on each side, plus the 8 px occupied by the overlay scrollbar, and its pin buttons
wrap at narrow widths.

Both browser orientations use one named workspace selector. Its menu supports
switching and workspace creation; the existing editor anchors to the visible
trigger and returns focus on Escape. The sidebar uses the same named selector in a compact footer, opening upward.

Chevron opacity and position transition for 160 ms. At an endpoint, the hovered
control stays visible and inert at 35% opacity. On mouse leave, it remains painted
through the fade and then becomes hidden. This lifetime is explicit because the
tested engine did not honor delayed CSS visibility as required. Reduced motion
removes the transitions. `verify-states.ts` measures intermediate opacity **and**
visibility, stable hover bounds, compact pin dimensions, and scrollbar clearance.
Run against a fresh isolated scenario with an existing output directory:

```sh
bun demos/derpdesign/haz-tabs/verify-states.ts /absolute/session.json /tmp/haz-state-review
derpdesign sequence --session /absolute/session.json --pane haz-horizontal --file demos/derpdesign/haz-tabs/workspace-switch-checks.json --out /tmp/workspace-switch-report.json
derpdesign sequence --session /absolute/session.json --pane haz-horizontal --file demos/derpdesign/haz-tabs/horizontal-checks.json --out /tmp/horizontal-report.json
```

Do not run concurrent sequences against the same pane. Captures after each
interaction remain necessary: a passing DOM assertion alone cannot establish
hover, clipping, or transition quality.


## Split views and child tabs

Four dedicated panes expose child groups in vertical and horizontal layouts,
side-by-side split pages with children, and stacked split pages. Sidebar pairs
use two full-width rows; horizontal pairs reserve two normal tab widths. Both
members retain their close actions. Child tabs have visible indentation/guides
in the sidebar and retain the same icon treatment in the horizontal strip.

The page fixture reuses `mountSplitDemo`; split membership, page activation,
divider dragging, axis switching, group menus, and closing are the actual shell
and controller behavior. Regression tests cover the fixture's tree ordering
when splitting roots (promoting existing children, as native code does), regrouping their children and when detaching a child before
another group. These scenarios must remain valid after interaction.

Close actions are now visible by default. Titles use ellipsis and horizontal
tabs are 200 px wide; sidebar padding is reduced rather than hiding a reserved
close slot behind a broad empty gutter.

## Density correction

Reread all nine source posts on November 17 and revisited their spacing, overflow, and nested-corner frames. The settings header now uses 10 px vertical padding, content uses 20 px (16 px narrow), section spacing is 16 px, and section headings sit 10 px from their controls. Dialog padding is 16 px, matching the roomy-dialog example. Layout previews remain compact instead of expanding across the available viewport. Tab rows retain a 6 px inset independently of the flush scrollbar. The named workspace selector replaces the large icon footer in both orientations.

## Final geometry and pin balancing

The horizontal strip is 38 px high. Its outline starts half a pixel inside the top edge so the stroke stays visible without a top gap. The curved outline is clipped to the scrolling viewport; separate baseline segments continue beneath fixed controls. Close actions, overflow arrows, the plus button, and workspace selector share a content center. Pointer-driven reveal starts after click (not pointer-down) and includes the entire tab and close action.

Normal URL fields use #18181b; compact fields use #111114 against the darker sidebar. Neither has a visible border or shadow at rest. Focus remains visible.

Sidebar pins use up to six columns, balanced across rows: 1–6 each use one row; 7 uses 4+3, 8 uses 4+4, 9 uses 5+4, and 10 uses 5+5. Each row stretches across the available width. Narrow sidebars reduce capacity before balancing. The count gallery mounts the real shell and controller ten times, so selection and hover are live rather than illustrations.

The outer tab-strip frame follows the same 1 px stroke and #35373b color as the selected-tab contour, including the fixed-action area. The source palette is #0c0e12 for inactive chrome and #202226 for the selected surface. All horizontal icons, titles and actions share the 19 px centerline; tab icons have a 12 px leading inset and separators are 14 px tall. Selection animates the shared contour; pinning and unpinning animate the actual tab nodes, width and icon position over 280 ms, with reduced-motion support.

Sidebar scroll thumbs are 4 px wide inside the existing 6 px tab margin, with no reserved scrollbar gutter. They appear during scrolling/dragging and fade out after 650 ms of inactivity. Row favicons and close actions use matching horizontal/vertical insets; child connectors span the inter-row gaps. Address forms use flex alignment to avoid the inline input baseline offset.

## Toolbar panels

Styles, Scripts, Proxy and the browser menu share neutral surfaces, 320 px widths, 6 px container insets and aligned rows. Page-source panels use the actual product components with stateful in-memory ports. Their neutral switches have 32 × 20 px tracks and 14 px thumbs centered on the vertical midpoint; keyboard Space toggles preserve focus. Source counts fade/scale for 160–180 ms and retain their previous nonzero number during exit. Reduced motion disables transitions. Duplicate source-manager and tab-layout entries were removed from the main menu.

The Vite patch handles protocol errors on HMR ping sockets so malformed native-client close frames cannot terminate the preview server. `usercss-meta` is prebundled for the real Styles manager.

## Production integration

The approved chrome now lives in `src/ui/design/`. The native shell and this
harness both mount `mountBrowserChrome` and `mountBrowserPages`; the files here
re-export the production styling and behavior. Fixture data and simulated web
page contents remain in the harness. Native new-tab and appearance pages use the
same components; “All browser settings” retains access to existing native
settings outside this study. Theme and close-button visibility persist through
the native preferences protocol.

Capture settled snapshots before and after a change, then compare every pixel:

```sh
python3 scripts/test-design-parity.py BASELINE ACTUAL --report parity.json
```

The native pointer/keyboard check accepts an already running browser on an owned
compositor, with a fresh profile initially showing a new tab:

```sh
python3 scripts/test-design-native.py --environment ENVIRONMENT_JSON --output OUTPUT --port 18997
python3 scripts/test-browser-layouts.py
python3 scripts/test-browser-layouts.py --splits
```
