# DerpBird developer tools design

Research and implementation: 2026-11-15.

## References examined

- [Chrome Network reference](https://developer.chrome.com/docs/devtools/network/reference) and its [actual UI screenshot](https://developer.chrome.com/static/docs/devtools/network/reference/image/the-network-panel.png): compact top-level tabs, a separate request filter, type filters, selectable request rows, response detail tabs and a bottom summary. Retain this hierarchy, with DerpBird's charcoal surfaces and sage selection color. Omit promotion, assistance, unrelated panels and configuration controls without a supported behavior.
- [Firefox request details](https://firefox-source-docs.mozilla.org/devtools-user/network_monitor/request_details/): selected-request details at the right, grouped headers and structured response inspection. Use a bottom split at narrow widths.
- [Chrome ViewportDataGrid source](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/data_grid/ViewportDataGrid.ts): visible-row calculation, filler space and reveal-on-navigation. Use fixed 26px rows, eight rows of overscan, indexed positions and independent request/response scroll state.
- [Chrome JSONView source](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/source_frame/JSONView.ts): searches populate tree nodes and expand ancestors when jumping to a result; current source limits search population to 10,000 visited nodes. Our search scans an independent flat index, including collapsed content, without a node-count truncation. Rendering is bounded separately. This is not a claim that current Chrome has no preview search.
- Local Ladybird `Documentation/DevTools.md` describes its Firefox actor protocol. The shipping tools use a trusted WebUI → Qt → Hub adapter around the existing ViewImplementation inspector, console and network callbacks. They do not require an external Firefox-protocol client.

## Implemented behavior

Only Elements, Console, Sources and Network are top-level panels. Network supports URL, `status:` and `method:` filters, resource-type filters, numeric sorting, request selection, arrow-key selection, a waterfall, detail resizing by pointer or keyboard, clear, headers, payload, JSON preview, raw response and overall request duration.

Preview searches keys and values, reveals the ancestors of the active match, highlights text and scrolls to the matching row. Enter/Shift+Enter and previous/next buttons wrap. Case-sensitive matching is optional. Counts represent matching fields (raw view: matching lines), not individual repeated substrings in one field. Raw response rendering is also virtualized. Text responses use a text-row fallback; no response HTML is executed. Captured image bytes travel as a typed base64 payload and render as an image with MIME type, dimensions and byte size. Preview uses captured data rather than re-requesting the URL. Network icons have distinct colors by resource type.

Elements inspects the live DOM and computed styles, automatically following batched DOM mutation notifications without a refresh button. Sources lazily retrieves registered scripts and highlights matches. Console receives native messages and evaluates expressions in the inspected page. Inspect opens a tab-scoped native inspector from the page context menu, browser menu or F12. It docks right by default, with left/bottom/undocked positions in the toolbar menu, a draggable native splitter, and a remembered dock preference. Pick element uses the native page hit tester; computed styles scroll independently. All interface icons use EffectWeb Lucide components. The demo mounts these same shipping components and native protocol decoder with a deterministic external transport; its evaluator explicitly rejects unsupported expressions.

## Performance and limits

EffectWeb `modelOwner` / `view` / `mount` follow the existing manager components. Request filtering and summary totals are computed on filter changes, not scroll. Responses load on selection, with an eight-response cache and generation checks against stale asynchronous results. The JSON index is built iteratively. Requests, parsed preview and raw response use bounded visible windows.

Large scenario: 10,000 requests, 12,000 nested objects, 4,991,199 response bytes and 156,010 indexed JSON rows. Ladybird search reaches `project_12000`; the captured DOM contains 47 request rows and 20 preview rows. This establishes bounded rendering and search correctness, not a frame-time or input-latency guarantee. Parsing/search currently execute on the UI thread. Native events are batched every 50ms; capture is bounded to 10,000 requests, 2,000 console messages, 5,000 sources, 8MiB per response and 64MiB of response bodies per session. Response bodies and source text load on demand. Breakpoints, style editing, source maps, HAR import/export and streaming are not implemented.

## Reproduction

The existing desktop demo is `derpbird-devtools`; its source now uses the shipping UI. The inactive `derpbird-devtools-integrated` declaration also includes the browser-menu scenario, without replacing the user’s active demo. Its declaration is `devtools-declaration.ts`; fixture data is `devtools-fixture.ts`. Real UI implementation lives in DerpBird `src/devtools/`.

Run `devtools-checks.json` through `derpdesign sequence` in an isolated session. It checks hidden JSON search, next-match navigation, raw response search, headers, filtering, console evaluation, source selection/search and element selection. Large and edge-case check sequences and versioned reports are under DerpBird `artifacts/devtools/`. Tests in `tests/devtools.test.ts` cover independent indexing/filter/window behavior.

Native regression `TestDerpBirdDevTools` exercises a real inspected page, computed styles, fetched JSON preview search, console evaluation and script retrieval through the shipping UI. `TestDerpBirdShell` verifies shell startup. Adapter tests are in `tests/devtools-native-port.test.ts`; integration/menu/icon capture reports are in `artifacts/devtools/`.

Native desktop regression `scripts/test-devtools-docking.py` launches its own headless Wayland compositor and browser profile to verify positioning, renderer continuity, picking, splitter dragging, computed-style wheel scrolling and teardown.
