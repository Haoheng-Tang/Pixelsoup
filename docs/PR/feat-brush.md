# feat: Brush, Eraser, colours and the Eyedropper

## Summary

Step 7 of the build order: Pixelsoup can paint. Four new things, built on one stroke engine in
core:

- **Brush (B)** paints the active layer with the foreground colour, and **Eraser (E)** erases it
  to transparency on any layer. Both have size (1–500 px), hardness and opacity, with sliders and
  number fields, and an optional pen pressure toggle for size, opacity or both. `[` and `]` step
  the size, Shift+`[` and Shift+`]` the hardness, and the status bar shows the new value.
- **Photoshop opacity semantics**: a stroke accumulates into a stroke mask by keeping the
  maximum, so overlapping dabs within one stroke never paint more than the stroke's opacity,
  while the next stroke builds on it. Painting clips to the selection, soft edges included, and
  painting past a layer's edges grows the layer.
- **Foreground and background colours** are session state, shown as two overlapping swatches in
  the toolbar. Clicking one opens a picker with a saturation/brightness square, a hue strip, and
  hex and R, G, B fields. X swaps them and D resets them to black and white.
- **Eyedropper (I)** picks the colour under the pointer into the foreground, or with Alt into the
  background, from the composite (the default) or the active layer alone. Holding Alt with the
  Brush or Eraser turns it into the eyedropper until it's released.

Each stroke is one undo step that restores the exact bytes. Strokes are painted once per
animation frame, from every pointer position the browser reports (coalesced events included), so
fast strokes leave no gaps. Shift-click draws a straight line from where the last stroke ended,
and Esc cancels a stroke in progress.

Colours aren't saved and changing them isn't an undo step. The `.pixelsoup` format is unchanged.

## What's included

Commits are meant to be reviewed one at a time:

1. **Share the frame clock between tools** (refactor, no behaviour change): the Move tool's
   injectable animation-frame clock moves to `frame-clock.ts`, and the test `FakeClock` to
   `fake-clock.ts`, so the painting tools can use them.
2. **Share the layer growth path between merges and commits** (refactor, no behaviour change):
   `Placement`, `place`, `placementOf` and the 8192-pixel rule (`growthArea`) move to
   `layer-growth.ts`, and `rasterBounds`, `toLayerSpace` and `containsRect` to `layer.ts` and
   `geometry.ts`, so strokes grow a layer the same way merges and commits do.
3. **The dab and stroke-mask engine** (`src/core/paint`):
   - `dab.ts`: a round dab of diameter `size` at any fractional centre. Its profile is 1 out to
     hardness × radius, then falls smoothly (1 − smoothstep) to 0 at the radius. `DabProfile`
     averages that profile across each pixel along the radius, so coverage (0–255) is exact
     and even a 100 % hard dab has a 1-pixel anti-aliased edge.
   - `dab-placer.ts`: `DabPlacer` puts a dab at the first position, then one every
     `dabSpacing(size)` = max(1 px, 10 % of the size) along the straight segments between
     positions, carrying the leftover distance into the next segment. Pen pressure is
     interpolated along each segment and scales size, strength or both.
   - `stroke-mask.ts`: `StrokeMask` is a canvas-sized coverage mask in sparse 64 px tiles
     (`tiles.ts`). Stamping keeps the maximum, stays inside a clip rect, skips unselected
     pixels, and reports the area it raised.
   - `paint-math.ts`: exact integer paint ("over" in straight alpha) and erase math, weighted by
     mask × selection coverage × opacity, correctly rounded.
   - `pixel-buffer.ts` gains an `Rgb` type for opaque colours.
4. **Brush and eraser stroke commands** (`stroke-commands.ts`):
   - `beginStroke(doc, layerId, style, floating)` starts a `PaintStroke`, or returns null for a
     missing or hidden layer, a stroke opacity of 0, or nowhere to paint. The paintable area is
     the canvas ∩ the selection's bounds, and also the layer's bounds when erasing or painting a
     floating selection.
   - Each frame, `strokeCommand(stroke, dabs)` stamps that frame's dabs and returns a
     `StrokeCommand` that repaints only the area they raised. All of a stroke's commands share
     its `mergeKey`, so the stroke is one undo step ("Brush Stroke" or "Eraser Stroke").
   - The stroke keeps the layer's original pixels in 64 px tiles, each captured just before it's
     first painted. Undo restores them exactly; redo repaints the stroke from its mask.
   - Painting past the layer's edges grows it through `growthArea` (to the canvas at most), and
     undo puts back the old buffer and position. Erasing never grows a layer.
   - Each step dirties the area painted and lists the layer in `layerPixels` (`rect: null` when
     it grew), so the viewport and thumbnails update through the usual change path.
   - `FloatingSelection` gains `edited`. The first stroke on a floating layer sets it (reported
     through `DocumentChange.floating`, so undo clears it), and `CommitFloatingCommand` then
     composites rather than restoring the lifted snapshot, so the paint is kept.
5. **Foreground and background colours with a picker** (`src/ui/color`):
   - `Colors` holds both colours as session state, with subscribe, swap and reset.
     `color-math.ts` converts between RGB, HSV and hex, keeping the hue of greys and black
     while editing.
   - `ColorSwatches` shows them in the toolbar as overlapping swatches with swap and reset
     buttons. `ColorPicker` is a popover that edits a colour live: a saturation/brightness
     square and hue strip drawn on canvases, plus hex and R, G, B fields. Enter or a click
     elsewhere keeps the colour; Escape restores the one it opened with.
   - `useColorShortcuts`: X swaps and D resets, ignored with modifiers, while typing and while a
     dialog is open.
   - `styles.css` gains spacing, radius and type tokens, and all new UI uses CSS variables, so a
     redesign is a token change.
6. **The Eyedropper** (`eyedropper-tool.ts`):
   - Picks on press and while dragging; Alt at the press picks the background. Escape mid-drag
     puts back the colour from before the press. Never an undo step.
   - Core's `sampleColor` reads the composite of the visible layers or one layer's own pixels.
     A transparent pixel picks nothing; a partly transparent one gives its colour without its
     alpha.
   - Options: sample the composite or the active layer. E and I join the tool keys.
7. **Extend the tool system for painting tools**:
   - `Tool.overlay` becomes a `ToolOverlay` union: the marquee shapes, or a `BrushOverlay`. The
     brush outline is a circle in document space, so it scales with the zoom, drawn as a line
     over a halo (`--cursor-line`, `--cursor-halo`); below 4 CSS px it becomes a crosshair on
     the device pixel grid. It hides while the pointer is off the canvas or panning.
   - Tool pointer events carry pen `pressure` (pens only) and the coalesced `samples` since the
     previous event.
   - `ToolContext.showMessage(text)` flashes text in the status bar for 1.5 s; `stepBrush`
     lets the active tool handle the bracket shortcuts through `ToolManager.stepBrush`.
   - The viewport re-sends the pointer when the view or the active tool changes, so a new tool
     shows its outline at once. `FakeViewport` can send pressure and coalesced samples.
8. **The Brush and Eraser tools** (`paint-tool.ts`):
   - `PaintTool` queues positions as they arrive and paints them once per animation frame
     through the core engine; release paints the rest. One press to release is one undo step.
   - Shift-click draws a straight line from where this tool's last stroke in this document
     ended.
   - Escape, pointer cancel or window blur undo the stroke so far, leaving it redoable. If
     something else changes the document mid-stroke (an undo, a selection change, another
     document), the stroke ends there.
   - A hidden active layer isn't painted, and the status bar says why.
   - Alt, outside a stroke, shows the eyedropper cursor and picks the foreground colour with the
     eyedropper's sampling option.
   - `BrushOptions` (one set per tool: the Brush starts at 30 px, the Eraser at 50) and
     `BrushOptionsPanel`: an exponential size slider, hardness and opacity sliders with number
     fields, and the pressure toggle with its size/opacity/both choice. `[`/`]` step the size
     through 1–10, 20–100 in tens, then 125 … 500; Shift steps the hardness by quarters.
   - `useBrushShortcuts` matches brackets by key position as well as character, like the layer
     shortcuts, and leaves Ctrl/Cmd+[ and ] and Alt+[ and ] to them.
   - Fix: the app's grid column can no longer grow past the window when a tool's options bar is
     wide.
9. **Docs**:
   - `docs/tools.md`: colours and the eyedropper, the stroke engine (dabs, spacing, the stroke
     mask, opacity semantics, commands, undo and growth), the Brush and Eraser, how a new
     painting tool reuses the engine, and painting's open decisions.
   - `docs/layers.md`: strokes' dirty rects and `layerPixels`, the shared growth path, and
     painting a floating selection.
   - `CLAUDE.md` marks step 7 done, adds `paint/` and `color/` to the layout, and notes that
     strokes keep 64 px tiles. It stays at 199 lines; the "Panning" open decision moved into
     `docs/tools.md`'s input routing section.
   - The README lists the painting features and has a painting shortcuts table.

## Design notes

- **Max, not sum**: the stroke mask keeps the highest coverage any dab gave each pixel, and the
  layer is repainted from its original pixels with that mask. So dab spacing and overlap don't
  change how dark a stroke gets, the result depends only on the stroke's path, and opacity
  means what it does in Photoshop.
- **Repaint from originals**: each frame repaints only the raised area, from the saved
  originals, not on top of the previous frame. Rounding never accumulates, and redo just
  repaints the whole stroke.
- **Tiles instead of one growing `PixelSnapshot`**: the spec suggested a snapshot that grows with
  the stroke's bounds. A long diagonal stroke would then store its whole bounding box, so the
  stroke keeps only the 64 px tiles it touches (16 KB of pixels and 4 KB of mask each, about
  11 MB for a stroke over all of 1920 × 1200). Other pixel commands still use `PixelSnapshot`.
- **Exact integer math**: weights are mask (0–255) × coverage (0–255) × opacity in 1/10000
  steps, all exact in doubles, so every result is correctly rounded and the tests can assert
  hand-worked bytes.
- **Live painting through history**: like the Move tool's drags, each frame executes a
  `StrokeCommand` with the stroke's merge key. The viewport, thumbnails and dirty state update
  through the normal change events, and there's no separate preview path.
- **One stroke per frame of input**: pointer events only queue positions; painting happens once
  per animation frame. Coalesced events keep the stroke's shape however fast the pointer moves.
- **Growth reuses the merge path**: a brush stroke past the layer's edges grows the layer the
  same way Merge Down and committing a floating selection do, to the union of the bounds or the
  canvas. Erasing never needs to grow, and a floating layer stays its own size.
- **Colours are session state**, like the active layer and tool: not in the document, never
  saved, never undone, so picking colours doesn't make a document unsaved.
- **Pressure only from pens**: mice and touch report a fixed 0.5 pressure in most browsers,
  which would halve every stroke, so the viewport only passes pressure for `pointerType` pen.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 472 tests across 44 files (104 new, in 13 new files)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:5173
```

Unit tests cover:

- **Dabs**: a hard dab's 1-pixel anti-aliased edge, a 1 px dab on a pixel centre, the soft
  fall-off, full coverage inside hardness × radius, coverage never rising with distance, and
  bounds that reach every pixel.
- **Spacing and the stroke mask**: a tenth of the size and at least 1 px, even spacing along a
  fast straight stroke with no gaps, leftover distance carried across segments, pressure, dabs
  at pixel centres, corners and fractional centres stamping symmetrically, max accumulation,
  clipping to the clip rect and selection, and tile edges.
- **Paint math** against hand-computed bytes: full and zero weight, opaque, translucent and
  transparent originals, and erasing to transparent black.
- **Stroke commands**:
  - brush and eraser pixels for opaque, translucent and transparent originals at several
    mask × opacity × coverage products;
  - selection clipping at partial coverage; no build-up within a stroke, build-up across strokes;
  - one undo step that restores the exact bytes, and redo;
  - dirty rects and `layerPixels`; growing the layer, also up to the canvas, and undoing that;
  - hidden layers, zero opacity, erasing that never grows, floating selections marked edited
    and not grown, and merging only steps of the same stroke.
- **Colours and sampling**: RGB/HSV/hex conversions (every 8-bit colour on a grid round-trips),
  `Colors` swap, reset and notifications, and `sampleColor` from the composite and a layer,
  over transparency, hidden layers and off the canvas.
- **Eyedropper tool**: foreground and Alt background picks, the layer option, dragging, Escape
  and claiming Alt.
- **Brush tool**: 16 pointer and key sequences through the `ToolManager` with `FakeViewport` and
  the fake frame clock: one undo step per stroke with one command per frame, coalesced samples,
  pressure on and off, Shift-click lines, the eraser, Alt sampling and its cursor, Escape,
  ending when the document changes, hidden layers, size and hardness steps, and the outline.
- **Options and shortcuts**: `BrushOptions` defaults, clamping, size stops, hardness quarters and
  the exponential slider; bracket matching by key position, and leaving the layer shortcuts
  alone.

In the browser, with a photo open:

- [ ] B, E and I select the Brush, Eraser and Eyedropper. The brush outline follows the pointer,
      scales with the zoom, becomes a crosshair when tiny, and hides off the canvas.
- [ ] A soft 100 px brush at 50 %: fast scribbles leave no gaps and don't darken where the stroke
      crosses itself; a second stroke over the first does darken.
- [ ] A hard 1 px brush at 800 % zoom: a crisp line with a 1 px anti-aliased edge.
- [ ] Marquee an ellipse and erase across its edge with a soft brush: a soft edge inside,
      nothing changed outside.
- [ ] Import a small image as a layer and paint off its edge: the layer grows (its thumbnail
      too), and undo shrinks it back.
- [ ] Undo and redo several strokes, one stroke per step.
- [ ] `[` / `]` and Shift+`[` / `]` change size and hardness, shown briefly in the status bar.
- [ ] Shift-click draws a straight line from the end of the last stroke. Esc mid-stroke cancels.
- [ ] Hold Alt with the Brush: the eyedropper cursor appears, and a click picks the foreground
      colour. The Eyedropper with Alt picks the background colour.
- [ ] Click a swatch: the picker edits the colour live; Enter keeps it, Esc restores it. X swaps
      and D resets.
- [ ] Hide the active layer and try to paint: nothing happens and the status bar says why.

These checks were run in headless Microsoft Edge with real pointer and key events sent through
the DevTools protocol, on a 1920 × 1200 photo, and then by hand. Results:

- **Soft 100 px at 50 %, fast scribbles**: no gaps. The most any pixel darkened within one stroke
  was exactly 0.500 (no build-up), and 0.743 where two strokes cross (0.7445 expected).
- **Hard 1 px at 800 %**: a line along pixel centres is one solid row with untouched
  neighbours. On a pixel boundary it splits 0.497 / 0.503 across two rows, and diagonals get
  1 px anti-aliased steps.
- **Eraser in an elliptical selection**: no pixels changed outside the selection. Partly selected
  edge pixels were erased by their inside neighbour's amount × coverage (410 pairs, mean
  deviation 0.0019).
- **Stroke off a 240 × 160 imported JPEG layer**: it grew to 1080 × 160, stopping at the canvas
  edge, then to 1080 × 332 with a second stroke. Two undos restored 240 × 160 with identical
  bytes, redo grew it again, and the thumbnail followed.
- **Undo and redo** of several strokes restored exact bytes each way.
- **Frame time on the 1920 × 1200 layer**, with fast strokes of about 80 document pixels a frame:
  1.7 ms a frame with a soft 100 px brush and 4.5 ms at 300 px, compositing included, at 59 fps
  with no long tasks.
- **Shift-click, Alt sampling and the Eyedropper** behaved as described: Alt picked the pixel
  underneath into the foreground without an undo step, and the Eyedropper's Alt-click set the
  background.
- **A floating selection brought back by undo** with the Brush active was painted within its own
  bounds, leaving the source untouched. Ctrl+D committed it with the paint kept, and six undos
  restored the photo byte for byte.

## Known limitations

- **Soft-brush ripple**: with dabs 10 % of the size apart and the mask keeping the maximum, a soft
  stroke's centre line ripples by up to about 3 % of its opacity. Closer spacing for soft
  brushes, or stamping whole segments analytically, would smooth it.
- **History memory**: each stroke keeps the tiles it painted (about 11 MB for one covering all of
  1920 × 1200), and one that grows its layer keeps the old layer whole, up to the 200-step cap.
- **Painting a floating selection** is only reachable through undo: switching from the Move tool
  commits it. A floating layer doesn't grow when painted past its edges.
- **Shift while painting** only matters at the press (a straight line); it doesn't constrain a
  drag to an axis as in Photoshop.
- **Eyedropper**: in its active-layer mode it samples the layer even while it's hidden.
- **Pen pressure** is covered by unit tests; it wasn't tried with a real pen.
- **Layer panel re-renders** on each painting frame. It caused no long tasks, but could be
  trimmed.

## Deliberately out of scope

- **A "background layer"**: the Eraser erases to transparency on every layer.
- **Brush presets, custom tips, spacing, flow, airbrush and blend modes** for painting.
- **Pencil, smudge, clone and other painting tools**: `docs/tools.md` describes how they'd reuse
  the engine.
- **Saving colours** or a swatch library: colours are session state.
- **GPU painting or compositing**: the CPU path keeps up at photo sizes; the GPU seam is
  unchanged.
