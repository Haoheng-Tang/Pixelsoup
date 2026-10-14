# fix: Marching ants on complex selections

## Summary

A Magic Wand pick on a photo can select thousands of tiny regions. Its marching ants strobed
when zoomed out, and the overlay was slow at every zoom: drawing the outline kept the
browser's GPU process busy several hundred milliseconds a second while the ants marched, the
view panned or a brush outline followed the pointer. This PR fixes the overlay without
changing the selection model, and keeps the outline exactly as traced from 100 % up.

- **A screen-resolution outline when zoomed out**: below about 67 %, the selection is reduced
  to cells of about one CSS pixel before tracing, so the outline has no more detail than the
  screen can show. Outlines are cached per selection and cell size, so panning never
  retraces, and a wheel zoom retraces 100 ms after its last notch, drawing the previous
  outline meanwhile.
- **Tiny loops hold still**: a loop shorter on screen than two dash cycles (16 CSS px) is
  drawn as a solid black line instead of blinking. Nothing is left out.
- **Cheaper animation**: the ants step about 12 times a second on a timer instead of
  checking every animation frame, and hold still while the view pans or zooms.
- **WebGL 2 ants**: the outline goes to the GPU once and each frame is a single draw call,
  whatever the pan and step. Where WebGL 2 isn't available, or while its context is lost,
  the overlay draws them in 2D, prerendering the dash phases of complex outlines and copying
  one per step.
- **View → Extras (Ctrl/Cmd+H)** hides or shows the selection's ants for the session. The
  selection stays, and tools work on it as before. The new View menu has room for a Quick
  Mask toggle later.

At 25 %, on a pick of about 2500 regions, the first trace and draw went from 165 to 13 ms and
panning lost all its slow frames. At 100 %, drawing the ants with WebGL rather than 2D took
the GPU process from 260 to 51 ms a second animating, 547 to 124 panning and 625 to 123 under
a hovering brush. Full numbers below.

The selection model, the tracer's results at a cell of one pixel and the `.pixelsoup` format
are unchanged. There are no new dependencies.

## What's included

Commits are meant to be reviewed one at a time:

1. **Trace selection outlines in screen-sized cells** (`core/selection-outline.ts`):
   - `downsampleSelection(selection, cell)` box-filters the coverage of each `cell` × `cell`
     block, anchored at the canvas's top-left, and keeps the block where the average is more
     than half, as `SELECTED_THRESHOLD` does for one pixel. Blocks cut short by the canvas's
     right and bottom edges average what's left of them. It sums only the blocks the
     selection's bounds reach, and a cell of 1 returns the selection itself.
   - `traceDownsampledOutline(selection, cell)` traces that and scales the loops back to
     canvas coordinates, clamped to the canvas. For a cell of 1 it's `traceSelectionOutline`.
   - `loopLength(loop)` measures a loop, closing edge included.
2. **Keep the marching ants smooth on complex selections** (`viewport/ants.ts`,
   `selection-overlay.ts`, `viewport-controller.ts`):
   - `ants.ts` holds the ants' logic, free of the DOM: the constants, `outlineCell(zoom)`
     (round(1 / zoom), 1 from about 67 % up), `traceAnts` (the outline with its loops sorted
     shortest first, their lengths, corner count and bounds), `staticLoopCount` (a binary
     search for the loops too short to march), `AntsOutlineCache`, `deviceRegion` and
     `AntPhaseCache`. `DocumentPlacement` moves here from the overlay.
   - `AntsOutlineCache` keeps the outlines for the four cell sizes used most recently and drops
     them for a new selection. While a wheel zoom is in progress, a cell size not yet traced
     gets the latest outline instead.
   - `AntPhaseCache` draws an outline with 2000 corners or more into eight offscreen
     canvases, one per step, covering its bounds on screen (at most 2 million device pixels,
     64 MB for all eight). Each is drawn when first needed, and drawn again into the same
     canvases after a pan, zoom, pixel ratio or outline change. The overlay strokes the
     outline directly while the view pans or zooms, for an outline's first draw (a floating
     selection on the move has a new outline every frame) and over larger areas.
   - `SelectionOverlay.draw` takes one `OverlayFrame` (selection, preview, placement, pixel
     ratio, zoom, step, and whether a wheel zoom or any view change is in progress) and
     strokes the still loops solid black and the rest as white under black dashes.
   - `ViewportController` steps the ants with a timer every 83 ms (`ANT_STEP_MS`), only while
     ants show and the view is still, instead of keeping a `requestAnimationFrame` loop
     running for as long as there's a selection. A wheel zoom sets `zooming` until 100 ms
     after its last notch (`ZOOM_SETTLE_MS`).
3. **Add the View menu with Extras to hide the ants** (`view-options.ts`, `ViewMenu.tsx`,
   `use-view-shortcuts.ts`):
   - `ViewOptions` is session state, like the colours: whether Extras show, with a revision
     counter and listeners for React. The viewport redraws its overlay when it changes, and
     neither steps nor draws the selection's ants while they're hidden. Tool previews still
     show.
   - The View menu has one checkable item, Extras (Ctrl/Cmd+H). `MenuButton` items can now
     carry `checked`, which makes them `menuitemcheckbox`es with a tick, and arrow keys move
     through them like other items.
   - `viewCommandFor` maps Ctrl+H and Cmd+H (not with Shift or Alt, so AltGr+H types).
     `useViewShortcuts` calls `preventDefault` (Ctrl+H opens history in some browsers), and
     ignores text fields, held keys and open dialogs.
4. **Draw the marching ants with WebGL 2** (`ants-gl.ts`, `ants.ts`, `selection-overlay.ts`):
   - `antSegments(outline)` lays the outline's edges out for the GPU: their ends as a
     `Float32Array`, and how far round its loop each starts and how long the loop is, in
     double precision. Edges of zero length are left out.
   - `antDashes(segments, scale, zoom, dpr)` works out where the dash pattern stands at each
     edge's start, in double precision on the CPU, and flags edges of loops too short to
     march. It runs once per outline and zoom (under a millisecond for 41,500 edges), so the
     GPU only adds the short distance along each edge, and long loops at high zoom don't
     lose precision in `float32`.
   - `GlAnts` draws each edge as one instanced quad, extended by half the line width and a
     pixel on every side for anti-aliasing, with square caps that fill the corners. The
     fragment shader works out each device pixel's coverage of the line and the dark share of
     the dash pattern across it, then blends a white line with black dashes over it as the 2D
     path does. Pan, zoom and step are uniforms, and a frame identical to the one showing
     isn't drawn again.
   - Its canvas goes between the composite and the overlay, so tool previews, the crop shade
     and the brush outline stay on top, and the overlay's own canvas isn't cleared or touched
     while it has nothing to show.
   - It's created when first needed. Without WebGL 2 the overlay draws the ants as before. A
     lost context hands them back to the overlay until it's restored. `SelectionOverlay`
     gains `dispose()`, which the viewport's `dispose()` calls, to remove both canvases and
     free the context.
   - `lineWidthFor(dpr)` moves to `ants.ts`, shared by both paths.
5. **Docs**:
   - `docs/tools.md` rewrites the "Drawing" section: the outline, zoomed-out cells, caching,
     line widths, marching, still loops, the WebGL ants, prerendered phases, View → Extras,
     and the measurements.
   - The README describes the ants on complex selections and the View menu, adds Ctrl/Cmd+H
     to the selection shortcuts and notes that Mac browsers usually take Cmd+H.

## Design notes

- **Cells anchored to the canvas, not the screen**: the cells don't move with the pan, so
  panning neither retraces nor shimmers the outline. Zooms that round to the same cell size
  share an outline.
- **More than half, like a single pixel**: a cell is selected when its average coverage
  passes 50 %, the tracer's own threshold. A region smaller than a cell can vanish from the
  outline, never from the selection; a 2 × 2 region at 25 % zoom always does, wherever it
  lies.
- **Exact from about 67 % up**: round(1 / zoom) is 1 from there, so the outline is the
  tracer's, pixel for pixel, as specified for 100 % and above.
- **Still loops are a prefix**: loops are sorted shortest first, so those too short to march
  at a zoom are found by a binary search, and the WebGL path flags them per edge with the
  same test (loop length × zoom < 16).
- **A timer, not a frame loop**: the old loop ran every animation frame just to see whether
  the step had changed. Now nothing runs while the ants hold still, and steps keep time from
  one to the next rather than from the redraw.
- **Why WebGL**: at middle zooms the pick's outline has 41,500 corners, and on a 2185 × 1168
  device-pixel overlay its bounds were too big to prerender, so each step, pan frame and
  brush move stroked its marching loops twice (the white line, then the dashes) and its still
  ones once. Turning the dashes off barely changed the cost: building the strokes' geometry
  was what took the time. Alternatives considered and set aside:
  - Screen-space stripe masks: a diagonal stripe can't follow the length along a staircase
    edge, so curved outlines would blink rather than march.
  - Tiles prerendered for all eight steps: about 126 MB.
  - SVG filters: Safari's 2D canvas has no `filter`.
- **The same look either way**: dashes are measured along each loop from its first corner,
  as the 2D canvas measures them, so both paths have one seam per loop where the pattern
  starts again, and the shader blends anti-aliased dashes over an anti-aliased white line as
  the 2D path does. Compared pixel by pixel at 25–400 %, they differ in anti-aliased pixels
  at the edges of lines and dashes (a mean of 2–5 levels at 400 %, 9–17 below), and look the
  same side by side.
- **Only the ants are on the GPU**: the composite is still drawn on the CPU, and tool
  previews are still stroked in 2D, which is cheap for one shape.

## Measurements

Production build in headless Edge (ANGLE on Direct3D 11, NVIDIA RTX 2000 Ada), a
2048 × 1030 CSS-pixel window at 125 % (a 2185 × 1168 device-pixel overlay), on a
1464 × 2022 photo. The pick is a non-contiguous Magic Wand click at tolerance 24: 3350 loops
and 41,500 corners at full resolution. GPU-process figures are CPU time in Edge's GPU process
per second; panning is 120 middle-button drag moves 16 ms apart.

**Zoomed out (25 %), `main` against this branch before the WebGL commit** (taken in an
earlier session whose baseline differs from the runs below, so compare within each table):

| Measure                               | `main`  | 2D ants  |
| ------------------------------------- | ------- | -------- |
| Trace and draw after the wand click   | 165 ms  | 13 ms    |
| GPU process while the ants march      | ~400 ms | 10–30 ms |
| Frames over 20 ms while panning (300) | 68      | 0        |

**Middle zooms, 2D path against WebGL** (GPU-process ms a second; the 2D figures are this
branch's fallback, forced on, which prerenders up to 67 % and strokes every step from 100 %):

| Zoom  | Animating | Panning   | Brush hover |
| ----- | --------- | --------- | ----------- |
| 25 %  | 64 → 55   | 358 → 110 |             |
| 50 %  | 110 → 87  | 424 → 163 |             |
| 67 %  | 87 → 79   | 622 → 113 | 108 → 139   |
| 100 % | 260 → 51  | 547 → 124 | 625 → 123   |
| 150 % | 281 → 69  | 580 → 143 | 622 → 99    |
| 200 % | 147 → 93  | 277 → 80  |             |
| 400 % | 205 → 115 | 334 → 141 |             |

In these runs every pan held 60 frames a second on this machine with either path. The GPU
process's load is what turns into dropped frames on a slower or busier machine, as reported at
middle zooms.

Moving a floating selection of this pick at 100 %, the overlay's share of each frame went from
52 to 17 ms. The frame as a whole still takes about 100 ms (see below).

## Known limitations

- **Moving a big floating selection is still slow**: its outline is traced again every frame
  and the move recomposites on the CPU, which this PR doesn't change. Reusing the traced
  outline with an offset, or a GPU compositor, would fix it.
- **Without WebGL 2**, middle zooms cost what the table shows before the arrows.
- **Wheel zooms** show the previous outline, scaled, until 100 ms after the last notch.
- **Cmd+H** usually hides the browser on a Mac; View → Extras always works.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 803 tests across 67 files (34 new; 2 new files)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover:

- **Downsampling and tracing**: a cell of 1 giving the selection itself; averaging with the
  threshold strictly over half; a 2 × 2 region at 25 % dropped wherever it lies, and at 50 %
  kept as one cell only where it fills one; cells cut short by the canvas; invalid cells;
  `traceDownsampledOutline` matching the tracer at a cell of 1, in canvas coordinates
  otherwise, stopping at the canvas's edges, and empty when every region is too small;
  `loopLength`.
- **The ants' logic**: `outlineCell` at a range of zooms; `traceAnts` sorting and measuring
  loops, keeping the document-space outline from 100 % up, and having no bounds when nothing
  shows; `staticLoopCount` at five zooms, with exactly 16 CSS px long enough to march;
  `lineWidthFor`; `antSegments` starts, loop lengths, closing edges and zero-length edges;
  `antDashes` against hand-worked dash positions and the still flag.
- **Caches**: `AntsOutlineCache` tracing once per selection and cell size (panning never
  retraces), retracing for a new selection, keeping the previous outline during a wheel zoom,
  keeping the four most recent sizes and clearing; `deviceRegion` mapping and cutting
  bounds; `AntPhaseCache` rendering each of the eight phases once and reusing them every
  cycle, starting again (into the same images) on a pan, zoom, selection, pixel ratio or
  overlay change, and releasing its images.
- **View menu**: `viewCommandFor` for Ctrl+H and Cmd+H, ignoring H alone, with Shift or with
  Alt; `ViewOptions` toggling and notifying subscribers.

Checked in headless Edge against the production build:

- The WebGL and 2D ants compared pixel by pixel at 25, 50, 67, 100, 150 and 400 %, at two
  steps, and side by side magnified at 67, 100 and 400 %.
- The canvases stack as composite, WebGL ants, overlay.
- Extras off clears the ants and keeps the selection; on brings them back.
- An Add-mode marquee preview draws over the WebGL ants, and a New-mode one hides them.
- The brush outline and the crop shade draw on top of the ants.
- Losing the WebGL context (`WEBGL_lose_context`) hands the ants to the overlay, and
  restoring it takes them back.

In the browser, with a photo open:

- [ ] A Magic Wand pick of thousands of regions (Contiguous off): at 25 % and 50 % the ants
      march without blinking, and specks hold still.
- [ ] Pan and wheel-zoom across 25 %–400 %: the ants hold still meanwhile, then march again;
      the outline sharpens about 100 ms after the wheel stops.
- [ ] At 100 % and 150 %, panning and hovering the Brush stay smooth.
- [ ] View → Extras and Ctrl+H hide and show the ants; the Magic Wand, Fill and Delete still
      act on the selection while they're hidden.
- [ ] Marquee and lasso previews, the crop box and the brush outline show over the ants.
- [ ] Move the selection with the Move tool: its ants follow it.
