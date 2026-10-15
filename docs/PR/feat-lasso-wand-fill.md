# feat: Lasso tools, Magic Wand, Paint Bucket, Fill and Clear

## Summary

Step 10 of the build order: Pixelsoup can select by outline and by colour, and fill. Every tool
plugs into the existing tool system, selection masks, selection modes and clipping invariant.

- **Polygonal Lasso and Lasso (L; Shift+L switches)**: the Polygonal Lasso adds a vertex per
  click with a rubber band to the pointer (Shift keeps it to 45° steps), takes vertices back with
  Backspace, and closes on its first vertex, with a double-click or with Enter; Esc abandons it.
  The freehand Lasso closes on release and, like Photoshop's, switches to straight segments when
  released with Alt held, until Alt comes up. Outlines show as marching ants while drawn, and
  become anti-aliased polygons that fill every loop of a path that crosses itself. With no
  outline in progress, Esc deselects. Both have cursors in the style of Photoshop's: a black
  arrow with a rope beside it.
- **Magic Wand (W)**: a click selects the pixels whose colour is within a tolerance (default 32)
  of the one clicked, connected to it or anywhere, with an optional 1-pixel soft edge, from the
  active layer or all visible layers. It honours New, Add, Subtract and Intersect and the Shift
  and Alt modifiers, like the marquees.
- **Paint Bucket (G)**: a click fills the region the wand would pick with the foreground colour,
  on the active layer, within the selection and at the options bar's opacity.
- **Edit menu, Fill and Clear**: Undo, Redo, Fill… and Clear, with room for Cut, Copy and Paste.
  Alt+Backspace fills with the foreground colour and Ctrl/Cmd+Backspace with the background,
  adding Shift preserves transparency, Shift+Backspace opens the Fill dialog and Delete clears
  the selection to transparency (Option/Cmd+Delete and delete on a Mac). The Fill dialog chooses
  the contents, opacity and preserve transparency, and remembers them for the session.

Every lasso and wand result goes through `combineSelections` and one `SetSelectionCommand`, like
the marquees. Every fill, clear and bucket click is one `FillCommand` or `ClearCommand`, which
weights each pixel by its selection coverage and undoes to the exact bytes. A click or key that
would change nothing adds no undo step. The `.soup` format is unchanged.

## What's included

Commits are meant to be reviewed one at a time:

1. **Polygon selections and flood regions** (`selection.ts`, `paint/flood-region.ts`):
   - `Selection.fromPolygon(width, height, points)` closes the path and fills where its winding
     number is non-zero, so a lasso that crosses itself fills every loop, even one it winds round
     twice. Edges are measured like an ellipse's: 16 sub-rows per pixel row, each span exact, for
     at least 16 levels. That span arithmetic is now a shared `RowCoverage`, and the edges
     crossing each sub-row are kept sorted by insertion sort, as their order barely changes.
   - `floodRegion(pixels, start, tolerance, contiguous, antiAlias)` returns a coverage mask. A
     pixel matches when each of its R, G, B and A is within `tolerance` (inclusive) of the start
     pixel's, and fully transparent pixels all count as (0, 0, 0, 0). Contiguous regions are
     4-connected, found by a scanline fill with no recursion: a growable `Int32Array` seed stack,
     and the mask as the visited set, so nothing is allocated per pixel. Anti-aliasing gives each
     pixel outside the region 255 × n / 8 for its n neighbours (of eight) in it, and leaves the
     region itself at 255.
   - `canvasPixels(doc, source)` gives the canvas as one layer has it (transparent beyond its
     edges, hidden or not) or as the composite of the visible layers ("sample all layers"), and
     `floodSelection(doc, x, y, options)` floods it into a `Selection`.
   - `geometry.ts` gains a `Point` type for fractional document coordinates.
2. **Share `grownPlacement` through `layer-growth`** (refactor, no behaviour change): the
   stroke's helper that copies a layer into a larger buffer moves next to `growthArea`, so fills
   grow layers exactly as strokes do.
3. **Fill and Clear commands** (`fill-commands.ts`, `paint-math.ts`):
   - `fillCommand(doc, layerId, color, opacity, mode, { region, floating, label })` builds a
     `FillCommand`. Each pixel's weight is region coverage × selection coverage × opacity, and
     no selection counts as everything selected. `normal` paints the colour over the pixel as
     the brush does (`paintPixel`); `preserve-transparency` uses the new `tintPixel`, which moves
     each channel towards the colour and keeps the alpha, so transparent pixels stay
     transparent. Exact integer math, correctly rounded.
   - A normal fill that reaches past the layer's edges grows the layer through `growthArea` and
     `grownPlacement`, to the union of its bounds and the filled area (or the canvas, if that
     union would exceed 8192 pixels on a side).
   - `clearCommand(doc, layerId, floating)` builds a `ClearCommand`: alpha becomes a(1 − c / 255)
     for coverage c, the colour stays, and a pixel cleared completely becomes transparent black,
     as the eraser leaves it. It's null without a selection.
   - Undo restores a `PixelSnapshot` of the pixels replaced, or the old layer whole if it grew.
     Both report dirty rects and `layerPixels` as strokes do. On a floating selection's layer
     they stay within its bounds and mark it `edited`, so committing it keeps the change.
4. **Share the selection tools' mode and commit logic** (refactor, no behaviour change): the
   marquee's `modifierMode`, `pressMode` and `applySelection` (combine, skip if unchanged, commit
   a floating selection, one `SetSelectionCommand`) move to `selection-tool.ts`, and
   `CLICK_TOLERANCE` to `tool.ts`, for the lassos and the wand.
5. **The Lasso and Polygonal Lasso** (`lasso-tool.ts`):
   - Both show a `LassoOverlay` (the points, the rubber band's end and whether a click would
     close), drawn by `SelectionOverlay` as ants with a 9 CSS px ring on the first point where a
     click would close it. In New mode the current selection's outline hides while drawing, and
     the status bar shows the outline's size (`lassoBounds`).
   - **Polygonal Lasso**: Shift snaps the rubber band, and the vertex a click adds, to 45° steps
     (`snapToAngle`), unless Shift picked the mode and hasn't been released since. A click within
     6 CSS px of the first vertex (`CLOSE_REACH`, once there are three) closes it, and clicks
     within 3 CSS px of the last vertex add nothing, so a double-click closes without adding a
     vertex. Backspace or Delete takes back the last vertex, and taking back the first abandons
     the polygon. Keys with Ctrl, Cmd or Alt held are left to the Edit shortcuts.
   - **Lasso**: dragging records every coalesced pointer position at least 1 CSS px apart, and
     releasing closes the outline. Released with Alt held, clicks add straight segments, a drag
     from a vertex draws freehand again, Backspace or Delete takes back a point, and releasing
     Alt, Enter, a double-click or a click on the first point closes it. An Alt that picked
     Subtract at the press does this only once released and pressed again.
   - An outline that never got 3 CSS px from its first point is a click, which deselects in New
     mode. Switching tools, replacing the document or changing the canvas size abandons an
     outline. Both tools have toolbar icons and share L.
   - **Escape** abandons an outline in progress; with none, it deselects as Select → Deselect
     does (`runSelectCommand`: one "Deselect" step, after committing a floating selection).
     Ctrl, Cmd or Alt with it, and a held Escape's repeats, are left alone, so holding it to
     abandon an outline keeps the selection. The viewport no longer hands the tool a key that
     something on the page has already used (`defaultPrevented`), so Escape closing a menu over
     the canvas doesn't deselect too.
   - **Cursors** (`LASSO_CURSOR`, `POLYGON_LASSO_CURSOR`), in the style of Photoshop's rather
     than a crosshair: a solid black arrow whose tip is the hot spot, with a rope at its lower
     right, its loop rounded for the Lasso and straight-sided for the Polygonal Lasso, black on
     a white edge so it shows on any colour. They're drawn from scratch as SVG, not copied from
     Photoshop. While the Lasso adds straight segments it shows the Polygonal Lasso's cursor,
     as Photoshop does.
6. **Move `NumberSlider` into its own module** (refactor): the brush options' slider and number
   field, now shared with the wand and the bucket. The unit is optional and the label can carry a
   tooltip.
7. **The Magic Wand** (`magic-wand-tool.ts`, `region-options.ts`, `RegionOptionsPanel.tsx`):
   - A click floods from the pixel clicked (`regionAt`) and applies the region with
     `applySelection`, in the options bar's mode or, with a selection, Shift (add), Alt
     (subtract) or both (intersect). One "Magic Wand" step per click, none if the selection
     wouldn't change.
   - Options (`RegionOptions`, the wand's own set): tolerance 0–255 (32), contiguous (on),
     anti-alias (on) and sample all layers (off), next to the selection modes.
   - A click on the canvas commits a floating selection first, so the wand sees the merged
     pixels; a click off the canvas deselects in New mode.
   - The lassos' options bar now explains how to use them.
8. **Fill and clear only the pixels they change** (`paintedArea`): a fill with a region or one
   that preserves transparency, and a clear, cover the smallest rect holding the pixels they
   change, and are null when there are none. A bucket click whose region misses the selection,
   or Delete over transparent pixels, adds no empty undo step.
9. **The Paint Bucket** (`paint-bucket-tool.ts`): `fillCommand` with the flood region, the
   foreground colour as it is at the click, the options bar's opacity and Normal mode. Its
   options are the wand's plus Opacity (1–100 %, default 100), kept separately. One "Paint
   Bucket" step per click. A hidden layer isn't filled and the status bar says why; a floating
   selection's layer is filled within its bounds.
10. **The Edit menu, Fill and Clear** (`EditMenu.tsx`, `edit-actions.ts`,
    `use-edit-shortcuts.ts`, `FillDialog.tsx`):
    - `runFill` and `runClear` act on the active layer and do nothing while it's hidden. While a
      selection floats its layer is the active one, so they change the floating layer rather
      than committing it; with another layer active, a floating selection is committed first.
    - `editShortcutFor` maps the keys. Backspace and Delete work alike (the Mac's delete key
      types Backspace): Alt fills with the foreground colour, Ctrl or Cmd with the background,
      Shift added preserves transparency, Shift alone opens the Fill dialog and no modifier
      clears. Ctrl+Alt (AltGr) and Cmd+Option match nothing. `useEditShortcuts` calls
      `preventDefault` on all of them, and ignores text fields, open dialogs, file operations,
      held keys and keys the active tool took.
    - The viewport now listens for keys on the document, so the active tool sees a key before
      the app's shortcuts on the window, which skip keys it took (`defaultPrevented`): the
      Polygonal Lasso's Backspace takes back a vertex rather than clearing the selection.
    - Menu items can be `plain` (no Ctrl/Cmd): `formatShortcut` shows Shift+Backspace and
      Delete, or ⇧⌫ and ⌫ on a Mac, and `aria-keyshortcuts` matches.
    - **Fill dialog**: Contents (Foreground colour, Background colour, Black, White, 50% grey, or
      Custom colour with a colour input that selects it when changed), Opacity (1–100 %) and
      Preserve transparency, with a hint saying whether the selection or the whole canvas will be
      filled. `AppController` opens it, runs it as one "Fill" step and remembers the settings it
      last filled with; a custom colour starts as the foreground colour.
    - Undo and Redo show the step's name. Fill… is enabled while the active layer is visible,
      and Clear while the selection's bounds reach it.
11. **Docs**:
    - `docs/tools.md`: polygon selections, the lassos, flood regions, the Magic Wand, and a new
      "Fill, Clear and the Paint Bucket" section (the commands, the Edit menu and its shortcuts,
      the bucket and open decisions), plus the lasso overlay, key routing and adding a tool.
    - `docs/layers.md`: fills' and clears' dirty rects and `layerPixels`, filling and clearing a
      floating selection, what commits one (a lasso, a Magic Wand click), and memory.
    - `CLAUDE.md` marks step 10 done and lists the new tools, staying at 199 lines. The README
      lists the tools and the Edit menu, with Lasso and Magic Wand and Edit shortcut tables.

## Design notes

- **One coverage engine for ellipses and polygons**: `RowCoverage` measures each sub-row's spans
  exactly, so polygon edges are anti-aliased exactly as ellipses' are, and a square polygon on
  whole pixels equals `fromRect`.
- **Non-zero winding, not even-odd**: a loosely drawn lasso that crosses itself fills every loop
  instead of leaving holes where it overlaps.
- **Tolerance per channel, against the clicked pixel**: as specified, each of R, G, B and A must
  be within the tolerance of the clicked pixel's. It's predictable and cheap; a perceptual
  distance or a running average could come later.
- **Every transparent pixel is alike**: whatever colour a fully transparent pixel holds, it
  counts as (0, 0, 0, 0), so colours hidden in an empty area (as imported PNGs can have) never
  split it, whatever the tolerance.
- **The soft edge goes outside the region**: anti-aliasing adds partial coverage around the
  region and leaves the region itself at 255, so a fill leaves no fringe of the old colour
  inside and blends into an anti-aliased outline.
- **Fills grow to the union, not the whole canvas**: the spec asked for a fill past a layer's
  edges to grow it to the canvas. It grows the layer to the union of its bounds and the filled
  area instead, through the same `growthArea` path as strokes and merges, so a layer grows only
  as far as the fill reaches. A fill with no selection still covers the whole canvas.
- **Only what changes**: fills and clears snapshot only the smallest rect holding the pixels
  they change, and one that would change nothing adds no undo step.
- **Floating selections**: the lassos and the wand commit a floating selection before changing
  the selection, as the marquees do. Fill, Clear and the bucket change the floating layer
  instead, as it's the active layer while it floats (the spec's "unless the floating layer is
  the active one"), and mark it edited so committing it in place keeps the change.
- **The tool sees keys first**: the viewport listens on the document and the app's shortcuts on
  the window, so a tool that uses Backspace stops it clearing the selection. The Polygonal Lasso
  leaves modified keys alone, so Alt+Backspace still fills; the Lasso's straight segments need
  Alt held, so it takes Alt+Backspace itself.
- **Photoshop's hybrid lasso is in**: releasing the freehand Lasso with Alt held switches to
  straight segments; the spec allowed skipping it.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 769 tests across 65 files (127 new; 9 new files)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover:

- **Polygons**: a square on whole pixels equal to `fromRect` either way round; the coverage of a
  triangle's slanted edge and a shallower edge; a self-intersecting bow tie filling both lobes;
  a loop wound round twice; clipping; degenerate and off-canvas polygons.
- **Flood regions**: tolerance boundaries (inclusive, the largest difference of any one channel,
  alpha included); contiguous against not; no leaks through diagonal gaps; winding paths that
  turn back up; transparent pixels; the soft edge, a one-pixel hole and the image edge; a 1 × 1
  and a uniform image; starts and tolerances out of range; a 2000 × 2000 fill well within a
  second; `canvasPixels` and `floodSelection` from a layer and from the composite.
- **Fill and Clear**: pixel math against hand-worked bytes at full, zero and partial coverage
  and opacity, a region times the selection, both fill modes and `tintPixel`; exact undo and
  redo; the areas reported; growing to the union or the canvas, and not when preserving
  transparency; null cases and covering only the pixels changed; filling and clearing a floating
  selection, kept on commit.
- **Tools**, as pointer and key sequences through the `ToolManager` with `FakeViewport`:
  - Polygonal Lasso: adding vertices and closing on the first as one step, the rubber band, the
    reach to close in screen pixels, a double-click without an extra vertex, Enter, Backspace
    and Delete, abandoning by Backspace and Esc, modified Backspace left to the Edit shortcuts,
    Shift's 45° steps, Shift and Alt picking the mode, deselecting in New mode, tool switches.
  - Lasso: closing on release as one step, point spacing, clicks, the Alt straight segments and
    their closing by Alt, Enter, a double-click or the first point, an Alt release that went
    unseen, Alt subtracting without switching, Esc mid-drag and between segments; L and Shift+L.
  - The lasso cursors: SVG images of an arrow whose tip is the hot spot, with a rounded or
    straight-sided rope, one per tool, and the Lasso switching to the Polygonal Lasso's while
    it adds straight segments, telling the viewport each time.
  - Escape with no outline in progress: deselecting with either lasso as one "Deselect" step,
    an outline in progress abandoned first, nothing without a selection, a held Escape's
    repeats and Ctrl, Cmd or Alt left alone, and a floating selection committed first.
  - Magic Wand: one step per click, tolerance in every channel, non-contiguous, the soft edge,
    every mode and modifier, clicks off the canvas, sample all layers, committing a floating
    selection first.
  - Paint Bucket: one step per click, the colour at the click, the soft edge, the selection and
    a region that misses it, opacity, the active layer against all layers, growing a smaller
    layer, hidden layers, off the canvas, floating selections.
- **Edit menu and shortcuts**: `editShortcutFor` for Backspace and Delete with Alt, Ctrl, Cmd and
  Shift, including the Mac's delete key, with AltGr and Cmd+Option ignored; `formatShortcut` for
  plain shortcuts and ⌫ and ⌦; `fillColor`, `canFill`, `canClear`, `runFill` and `runClear`; and
  `AppController`'s Fill dialog: filling, remembering, preserving transparency, Cancel, and not
  opening over another dialog or for a hidden layer.

In the browser, with a photo open:

- [ ] A 20-vertex Polygonal Lasso at 25 % and at 400 % zoom: the rubber band, Shift's 45° steps,
      Backspace, closing on the first vertex, with a double-click and with Enter; Esc abandons.
- [ ] A freehand Lasso, a Shift-add, and the Alt straight segments.
- [ ] The lasso cursors: each tool's own, and the Polygonal Lasso's while the Lasso adds
      straight segments.
- [ ] Esc with either lasso: while drawing it abandons the outline, and then it deselects, as
      one undo step; Esc closing a menu over the canvas leaves the selection alone.
- [ ] The Magic Wand on a sky at several tolerances, with Shift-adds and an Alt-subtract.
- [ ] The Paint Bucket into an anti-aliased region.
- [ ] Alt+Backspace on a lasso selection with soft edges; Ctrl/Cmd+Backspace; Delete.
- [ ] Shift+Alt+Backspace (preserve transparency) on a layer with a soft brush stroke.
- [ ] Shift+Backspace and Edit → Fill…: a custom colour at 50 %, remembered the next time.
- [ ] Undo through all of it back to the original.

These checks were run with a script driving headless Microsoft Edge through the DevTools
protocol, with real pointer and key events, on a public-domain 1464 × 2022 photo of the Statue
of Liberty against a cloudy sky. It ran against `npm run preview` (the same `dist/` Cloudflare
serves) rather than the Cloudflare preview, which needs the branch pushed. Lasso selections were
compared with `Selection.fromPolygon` of the points drawn, wand and bucket regions with a
separately written breadth-first flood, and every fill and clear, pixel by pixel, with a copy of
the paint math applied to the layer as it was before. Everything matched exactly, with no console
errors:

- **Polygonal Lasso at 25 %**: 20 clicked vertices, with the rubber band and the outline's size
  in the status bar. Hovering the first vertex showed the close ring, and clicking it closed the
  polygon (1009 × 1488, with 5,210 partly covered edge pixels).
- **At 400 %**: Backspace took back a vertex and kept the selection, a Shift-click landed at
  exactly −45°, and a double-click closed the polygon at 20 vertices without adding another. Esc
  abandoned an open polygon, leaving the selection, and Enter closed another.
- **Lasso at 50 %**: a 91-point freehand loop closed on release, a Shift-drag gave exactly the
  union and a click deselected. Released with Alt held, it switched to straight segments with a
  rubber band; Alt+Backspace took back a point without filling anything, a drag from a vertex
  drew freehand again, and releasing Alt closed the outline.
- **Cursors**: with the Lasso and then the Polygonal Lasso active, the canvas's computed cursor
  was each tool's SVG arrow and rope (rounded, then straight-sided) with its hot spot at the
  arrow's tip, 2, 2, and Edge decoded both at 32 × 32 under the production CSP, with no
  violations. Released with Alt held, the Lasso switched to the Polygonal Lasso's cursor, back
  to its own while the button was down, and back again when releasing Alt closed the outline.
- **Escape**: after a freehand Lasso outline (527 × 390), Esc deselected as one "Deselect" step
  and Ctrl+Z brought the selection back; Esc mid-drag, held for two repeats, abandoned the drag
  and kept the selection. With the Polygonal Lasso, Esc abandoned a polygon in progress
  (157 × 137 in the status bar) and kept the selection, and the next Esc deselected. Esc closing
  the Select menu with the pointer over the canvas left the selection alone.
- **Magic Wand on the sky**: tolerances 10, 32 and 64 selected 0.30, 2.08 and 2.11 megapixels,
  each identical to the reference. Two Shift-adds gave exactly the union and an Alt-subtract
  exactly min(old, 255 − new), and non-contiguous and hard-edged regions matched too. One "Magic
  Wand" step per click, at 30–50 ms a click.
- **Paint Bucket**: on a new layer, Alt+Backspace filled an elliptical selection with a red
  anti-aliased disc, and the bucket filled the disc blue, filling the region's 2,044 soft edge
  pixels in part. One undo restored the layer and redo filled it again. Into the layer's
  transparency it filled everything but the disc; with Sample all layers at 50 % opacity and
  tolerance 10, the region came from the photo and the fill went onto the new layer. A
  2-megapixel region took about 0.2 s.
- **Fill and Clear on the photo**: a star-shaped polygonal selection (2,212 partly covered
  pixels) filled with Alt+Backspace, with the background colour by Ctrl+Backspace and by
  Meta+Backspace (what Cmd+Delete sends), then cleared with Delete.
- **Preserve transparency**: Shift+Alt+Backspace with no selection, on a soft 150 px stroke at 0 %
  hardness, recoloured every pixel of it and kept the alpha of all 171,288 partly transparent
  ones exactly. The layer didn't grow.
- **Fill dialog and Edit menu**: Shift+Backspace opened the dialog with its defaults. A custom
  colour, #3366cc, at 50 % filled a rectangle; Edit → Fill… reopened the dialog with those
  settings, and Esc changed nothing. The menu read "Undo Fill", "Redo" (disabled), "Fill…
  Shift+Backspace" and "Clear Delete", and Edit → Clear cleared the rectangle.
- **Shortcuts**: every fill, clear and dialog shortcut was `defaultPrevented`. Typed into the
  brush's Size field, Backspace, Delete and Alt+Backspace were left to the field, and the
  document and its history didn't change.
- **Undo** through all 34 steps returned to the opened photo byte for byte, with one layer and
  no selection, and redoing all 34 restored every layer and the selection exactly.

## Known limitations

- **Matching** compares each channel with the clicked pixel's, with no perceptual distance and
  no running average, so a gradient is only followed as far as it stays within the tolerance of
  the clicked pixel.
- **Anti-aliased outlines at low tolerance**: the soft edge covers one ring of pixels around the
  region, so semi-transparent edge pixels further than the tolerance from the clicked colour
  keep some of their old colour.
- **Flood fills run on the main thread**: 30–50 ms for a wand click and about 0.2 s for a
  2-megapixel bucket fill on the test photo. A worker could take them off it.
- **Clear's menu item** is enabled by a quick bounds check, so it can be enabled when no
  selected pixel has any alpha; choosing it then adds no step.
- **Memory**: a fill that grows its layer keeps the old layer whole in history; other fills and
  clears keep only the rect they changed.
- **Mid-gesture**: like undo, the Edit shortcuts aren't blocked during a drag.
- **Hybrid lasso**: only the freehand Lasso switches to straight segments with Alt; the
  Polygonal Lasso doesn't switch to freehand.
- **Lasso cursors** don't show Photoshop's mode badges (+, −, ×) or its close circle; the
  overlay's ring marks where a click would close the outline.
- **The Fill dialog's custom colour** uses the browser's colour input, not the app's picker.
- **Mac keys** were checked by sending Meta+Backspace on Windows, not on a Mac, and the lassos
  weren't tried with a pen or touch.

## Deliberately out of scope

- **Cut, Copy and Paste**: the Edit menu leaves room for them.
- **Magnetic Lasso, Quick Selection, Color Range, Grow, Similar, Feather and Refine Edge.**
- **Pattern and content-aware fills, Edit → Stroke, and blend modes for fills.**
- **Saving selections** in `.soup` files: they're still session-only.
- **Flood fills in a worker or on the GPU.**
