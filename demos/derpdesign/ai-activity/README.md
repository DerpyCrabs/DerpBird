# AI activity prototype

Register with `bun demos/derpdesign/ai-activity/register.ts`; this adds an inactive demo to the desktop catalog. Pass an owned DerpDesign session file to register and activate in that session. The main project registration also includes this demo.

Demo: `derpbird-ai-activity`, pane: `ai-activity-live`, Ladybird, real DerpBird shell. The page and automation actions are simulated; this does not implement native input telemetry.

The 21-second timeline demonstrates approach/click, typing, drag/drop, scroll, pointer-free evaluation, then inactivity. Cursor and overlay are pointer-transparent. The `aiTime` condition freezes the timeline at a millisecond for deterministic inspection; absent means looping playback. No controls are added to the product chrome.

`checks.json` observes actual animation state changes and captures typing, dragging and evaluation through the DerpDesign sequence runner. Source: `demo.ts` / `demo.css`.
