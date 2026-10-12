# Tools, selections and painting

How editing tools plug into the viewport, how selections work, how the painting tools paint,
how Fill, Clear and the Paint Bucket fill, and the Crop tool. The code lives in
`src/core/selection.ts` (masks), `src/core/paint` and `src/core/commands/stroke-commands.ts`
(the stroke engine), `src/core/paint/flood-region.ts` and
`src/core/commands/fill-commands.ts` (flood regions, Fill and Clear), `src/ui/tools` (tools),
`src/ui/edit-actions.ts` and `src/ui/use-edit-shortcuts.ts` (the Edit menu's actions and
shortcuts), `src/ui/color` (colours) and `src/ui/viewport` (input routing and drawing).

## Selections (core)

- `Selection` is an immutable 8-bit coverage mask the size of the canvas: 0 is unselected, 255
  fully selected, values in between partly selected (anti-aliased edges). It caches its bounding
  rect (`bounds()`, null when empty) and `isEmpty`.
- Build one with `Selection.fromRect`, `fromEllipse`, `fromPolygon`, `selectAll`, `empty` or
  `fromMask`. Combine with `union` (max), `subtract` (min(a, 255 − b)),
  `intersect` (min) and `invert` (255 − a); move with `translate(dx, dy)` (whole pixels;
  coverage moved off the canvas is lost); follow canvas changes and transforms with
  `resizeCanvas`, `orient` and `transform`; read with `coverageAt(x, y)` (0 off the canvas) and
  `equals`. Every operation returns a new selection.
- **Anti-aliased shapes**: `fromEllipse` and `fromPolygon` give each pixel the fraction of it
  inside the shape. They split each pixel row into 16 sub-rows, measure each sub-row's span
  exactly and average, so edges get at least 16 levels. `fromPolygon(points)` closes the path
  from the last point back to the first and fills where its winding number is non-zero, so a
  lasso that crosses itself fills every loop, even one it winds round twice. Points may be
  fractional and lie off the canvas; fewer than three give an empty selection.
- `combineSelections(base, shape, mode)` applies a tool's mode (`replace`, `add`, `subtract`,
  `intersect`) and returns null when nothing ends up selected.
- `doc.selection` is null or a non-empty selection. `SetSelectionCommand` changes it, also
  through `selectAllCommand`, `deselectCommand` and `invertSelectionCommand` (null when they
  would change nothing). It reports the old and new bounds as `DocumentChange.selectionDirty`
  with no pixel `dirty` rect, and sets `changesContent: false`: selection changes are undo steps
  but don't make the document unsaved, because selections aren't saved in `.pixelsoup` files.
  Other commands change it as they move pixels: a `MoveLayerCommand` given a `selection` moves
  a floating selection's outline in the same step, and the canvas and transform commands carry
  or clear it ([transform.md](transform.md)).
- **Clipping invariant.** Every pixel-editing command clips to `doc.selection` when it isn't
  null, treating coverage as a per-pixel weight: `result = old + (new − old) × coverage / 255`.
  Lifting a floating selection weights the pixels it cuts out the same way, brush and eraser
  strokes multiply each pixel's paint weight by its coverage / 255, and so do Fill, Clear and
  the Paint Bucket. Layer properties
  such as opacity and visibility, and whole-layer operations (moving, transforming, merging,
  flattening, committing a floating selection), aren't pixel edits and ignore the selection.

## The `Tool` interface

| Member                          | Purpose                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`, `name`                    | stable ID (`rect-marquee`) and display name (`Rectangular Marquee`)                                               |
| `shortcut`                      | a key from `TOOL_KEYS`                                                                                            |
| `cursor`                        | CSS cursor over the canvas; it may change, like `overlay`                                                         |
| `OptionsPanel?`                 | React component shown in the tool-options bar                                                                     |
| `overlay?`                      | what to draw over the document (`ToolOverlay`, document coordinates): a marquee shape, a lasso or a brush outline |
| `activate(ctx)`, `deactivate()` | `ctx` gives the `Editor`, `overlayChanged()` (call when `overlay` or `cursor` changes) and `showMessage()`        |
| `pointerDown/Move/Up(e)`        | `e.x`, `e.y`: fractional document coordinates (pixel (px, py) spans [px, px + 1)); plus `zoom` and modifiers      |
| `cancel()`                      | abandon the gesture in progress without committing it                                                             |
| `doubleClick?(e)`               | a primary-button double-click, outside any gesture (the Crop tool crops)                                          |
| `keyDown/keyUp(e)`              | return true if the key was used, so the viewport suppresses the browser's default action                          |
| `stepBrush?(property, dir)`     | painting tools: `[` and `]` step the brush size down and up, with Shift its hardness                              |

- **Overlays**: a `ShapeOverlay` (`rect` or `ellipse`) previews a marquee; `hidesSelection`
  hides the selection's outline meanwhile. A `LassoOverlay` (`lasso`) is a lasso being drawn:
  its points, the rubber band's end (`next`) and whether a click would close it (`closing`),
  with `hidesSelection` too. A `BrushOverlay` (`brush`, with a centre and a
  diameter) is a painting tool's outline. A `CropOverlay` (`crop`, with the box and whether to
  show its grid) is the Crop tool's box.
- **Pointer events** from a pen carry its `pressure` (0–1; mice and touch report none). A move
  also lists every position the browser coalesced into it since the previous event
  (`samples`, oldest first, ending at `x`, `y`), so fast strokes keep their shape.
- **`showMessage(text)`** flashes text in the status bar for 1.5 s, e.g. a new brush size.

Tools are UI and never mutate the document directly: every change is a core command run through
`editor.history`. A gesture that should be one undo step either commits once at the end (the
marquees, the lassos) or gives its commands a shared `mergeKey` (the Move tool and the painting
tools). A click tool (the Magic Wand, the Paint Bucket) makes one step per click.

## ToolManager and input routing

- `ToolManager` holds the tools and the active one; `createToolManager` (in `create-tools.tsx`)
  builds the app's set in toolbar order. Activating a tool cancels and deactivates the old one,
  and is refused while a pointer gesture is in progress.
- Shortcuts (`useToolShortcuts`): tools that share a key form a group. The key selects the
  group's last-used tool and Shift+key cycles through it. They're ignored with Ctrl, Cmd or Alt,
  while typing and while a dialog is open. `TOOL_KEYS` has M marquee, L lasso, W magic wand,
  V move, B brush, E eraser, G paint bucket, I eyedropper and C crop, and reserves T text.
- `[` and `]`, with or without Shift (`useBrushShortcuts`), go to `ToolManager.stepBrush`
  wherever the pointer is: the active tool's `stepBrush` handles them, if it has one. X and D
  (`useColorShortcuts`) swap and reset the colours. Both are ignored while typing and while a
  dialog is open.
- The viewport handles panning (Space+drag, middle button) and wheel zoom itself, first. Space
  only pans while the pointer is over the canvas or the canvas has focus, so it still presses
  a focused button elsewhere. Other primary-button presses go to the tool, with pointer
  capture; moves with no button down are forwarded as hover. If the view changes mid-gesture,
  or another tool becomes active, the viewport re-sends the pointer so the tool sees its
  document position (and a painting tool can show its outline straight away).
- Keys go to the tool during a gesture, while the pointer is over the canvas, or while the
  canvas has focus, but never while a dialog is open (the viewport's `KeyGate`), so Enter and
  Escape reach the dialog. Escape during a gesture cancels it, as do pointer cancel, window
  blur, a tool switch and a document swap.
- The viewport listens for keys on the document and the app's shortcut hooks on the window,
  so the tool always sees a key first. The hooks skip keys it used (`defaultPrevented`): while
  a polygon is being drawn, Backspace takes back a point instead of clearing the selection.
- A primary-button double-click goes to the tool's `doubleClick`, unless the view is panning or
  a gesture is in progress.

## Drawing

`SelectionOverlay` draws on a transparent canvas stacked above the composite.

- The selection outline is traced once per selection by `traceSelectionOutline` (core): edges
  between pixels on either side of 50 % coverage, joined into closed loops with the inside on
  the right; pixels touching only diagonally get separate loops. The loops become a
  document-space `Path2D`, cached with the selection. Panning and zooming change only the
  transform, and animation changes only the dash offset (one CSS pixel every 60 ms). The frame
  loop only keeps running while something shows ants.
- Lines are `round(devicePixelRatio)` device pixels wide at every zoom and use the same snapped
  device placement as the composite, so they track pan and zoom exactly. Where pixel edges fall
  between device pixels (fractional device scales, such as 100 % zoom on a 125 % display) the
  line is anti-aliased across two device pixels.
- The tool's preview shape is drawn the same way; it's rebuilt each draw, which is cheap. A
  lasso is drawn as ants along its points and rubber band, left open, and where a click would
  close it, a 9 CSS px ring marks the first point.
- A painting tool's brush outline is a circle in document space, so it scales with the zoom:
  a `--cursor-line` line over a wider `--cursor-halo` one, so it shows on any colour. Smaller
  than 4 CSS px across, it becomes a crosshair on the device pixel grid. It shows only while the
  pointer is over the canvas (or during a stroke) and not while panning; the tool's own CSS
  cursor is `none` meanwhile.
- A selection with no pixel at 50 % coverage or more has no outline.
- The crop box shades everything outside it (`--crop-shade`), shows any area it adds beyond the
  canvas as a transparent checkerboard continuing the composite's, and while a drag adjusts it
  draws a rule-of-thirds grid (`--crop-grid` over `--crop-grid-halo`). Its outline and 7 CSS px
  square handles sit on the device pixel grid; edge handles are left out where they wouldn't
  fit between the corners.
- A floating selection on the move is a new selection each frame it moves, so its outline is
  traced again each time (about 7 ms for a 2000 × 1500 selection). Reusing the cached path with
  an offset would be cheaper, except where the canvas edge clips the selection.

The status bar shows the document pixel under the pointer and the size of the tool's preview (a
marquee while dragging, a lasso's bounds, or the crop box), else of the selection bounds. The
viewport reports both and `StatusBar` writes them straight into the DOM, as it does the tools'
`showMessage` text.

## Marquee tools

`MarqueeTool` comes as the Rectangular and Elliptical Marquee, sharing M (Shift+M switches).

- Drag from corner to corner; both ends snap to the nearest pixel corner. In New mode the live
  preview hides the current selection's outline.
- The mode comes from the options bar (New, Add, Subtract, Intersect; shared by the marquees,
  the lassos and the Magic Wand), overridden at the press when a selection exists: Shift adds,
  Alt subtracts, Shift+Alt intersects (`pressMode`).
- During the drag Shift constrains to a square or circle (the longer side wins) and Alt draws
  from the centre. A modifier that picked the mode at the press only constrains after it has
  been released and pressed again. With no selection, modifiers held at the press constrain
  straight away.
- Releasing commits one undo step named after the tool, unless the selection wouldn't change. A
  click (less than 3 CSS pixels of travel) or a shape entirely off the canvas deselects in New
  mode and does nothing in the other modes.
- A floating selection is committed first whenever the selection changes, as one more step.

The lassos and the Magic Wand finish the same way (`applySelection` in `selection-tool.ts`):
their shape goes through `combineSelections` and one `SetSelectionCommand` named after the
tool, after committing a floating selection.

## Lasso tools

`LassoTool` and `PolygonLassoTool` share L (Shift+L switches). Both draw an outline in
fractional document coordinates, shown as ants (see [Drawing](#drawing)), and close it into
`Selection.fromPolygon`, so edges are anti-aliased and a path that crosses itself fills
every loop. The mode and modifiers work as for the marquees: Shift or Alt held at the first
press with a selection picks the mode, and in New mode the current selection's outline hides
while drawing. Escape abandons the outline, and so do switching tools, replacing the document
and changing the canvas size.

- **Polygonal Lasso**: each click adds a vertex, and a rubber band follows the pointer from
  the last one. Shift constrains it, and the vertex a click adds, to multiples of 45° (unless
  Shift picked the mode and hasn't been released since). Backspace or Delete takes back the
  last vertex, and taking back the first abandons the polygon. A click within 6 CSS px of the
  first vertex (`CLOSE_REACH`, once there are three) closes it, as do a double-click and Enter.
  Clicks within 3 CSS px of the last vertex add nothing, so the double-click's second press
  doesn't add a vertex either.
- **Lasso**: dragging draws a freehand outline (every coalesced pointer position, at least
  1 CSS px apart), and releasing closes it. Like Photoshop, releasing the button with Alt held
  switches to straight segments instead: each click then adds a vertex, a drag from it draws
  freehand again, Backspace or Delete takes back the last point, and releasing Alt, Enter, a
  double-click or a click on the first point closes the outline. An Alt that picked the
  subtract mode at the press does this only after it has been released and pressed again.
- An outline that never got more than 3 CSS px from its first point is a click: it deselects
  in New mode and does nothing in the others, like a marquee click.
- Keys reach the lassos before the Edit shortcuts (see the key routing above): while straight
  segments are being drawn, Backspace and Delete take back a point rather than clearing the
  selection. The Polygonal Lasso leaves them to the Edit shortcuts with Ctrl, Cmd or Alt held,
  so Alt+Backspace still fills the selection; the Lasso's straight segments need Alt held, so
  it takes Alt+Backspace itself.

## Flood regions (core)

`floodRegion(pixels, start, tolerance, contiguous, antiAlias)` (`src/core/paint/flood-region.ts`)
picks the pixels like the one at `start` and returns a coverage mask the buffer's size.

- **Matching**: a pixel matches when each of its R, G, B and A (straight alpha) is within
  `tolerance` (0–255) of the start pixel's. Fully transparent pixels count as (0, 0, 0, 0)
  whatever colour they hold, so they match each other at any tolerance. Tolerance 0 picks
  exactly the start pixel's colour; 255 picks everything.
- **Contiguous**: the matching pixels connected to the start through their edges (4-connected:
  diagonal neighbours don't connect), found by a scanline fill: each popped seed fills its
  whole run of the row, then pushes one seed per run of fillable pixels just above and below.
  No recursion; the seed stack is a growable `Int32Array`, and the mask itself marks what's
  done. Otherwise, every matching pixel in the buffer.
- **Anti-alias** softens the region's edge by a pixel: each pixel outside the region gets
  coverage 255 × n / 8 (rounded) for its n neighbours (of eight) in the region. The region
  itself stays at 255, so a fill leaves no fringe of the old colour inside it.
- `floodSelection(doc, x, y, options)` runs it on canvas pixels (`canvasPixels`) and returns
  a `Selection`, or null off the canvas. Its `source` is one layer's own pixels in place,
  transparent beyond its edges and sampled even while it's hidden, or `'composite'`: the
  visible layers composited ("sample all layers").
- A 2000 × 2000 contiguous fill of a uniform image takes well under a second (a test checks
  it); filling is linear in the pixels visited.

## Magic Wand

`MagicWandTool` (W) selects with a click: the flood region around the pixel clicked
(`regionAt` in `region-options.ts`), combined with the selection like a marquee's shape.

- **Options** (`RegionOptions`, the wand's own set): tolerance 0–255 (default 32), contiguous
  (on), anti-alias (on) and sample all layers (off), next to the selection mode.
- The mode comes from the options bar or, with a selection, Shift (add), Alt (subtract) or
  both (intersect) at the press. Each click is one undo step, "Magic Wand", unless the
  selection wouldn't change.
- A click on the canvas commits a floating selection first, so the wand sees the merged
  pixels. A click off the canvas deselects in New mode and does nothing in the others.
- Without "sample all layers" it compares the active layer's own pixels, even while it's
  hidden, with transparency beyond its edges.

## Move tool

`MoveTool` (V) moves the active layer, or the selected pixels. The cursor is the move arrow
everywhere: there's no automatic selection of the layer under the pointer. The options bar only
explains the modifiers.

- **No selection**: a drag moves the active layer with `MoveLayerCommand`, which only changes
  its offset. Layers may end up partly or wholly off the canvas.
- **With a selection**, the first drag lifts the selected pixels out of the active layer into a
  floating selection (Alt held at the press copies them instead) and moves that, outline and
  all. Later drags and nudges move the floating selection; Alt+dragging it commits it and drags
  a copy. What commits a floating selection: [layers.md](layers.md#floating-selections).
- A drag takes hold after 3 CSS pixels of travel; a click does nothing. Nothing moves when the
  active layer is hidden, or when the selection misses it.
- Shift during a drag keeps it to the axis it has moved furthest along; pressing or releasing
  Shift mid-drag updates it straight away. Positions are whole pixels.
- **Nudges**: the arrow keys move by 1 px, 10 with Shift; Alt+arrow copies like Alt+drag. Nudges
  less than a second apart (`NUDGE_MERGE_MS`, measured from the previous one) are one undo step,
  as are all the moves of one drag. A lift (and a commit before a copy) are steps of their own,
  before the move.
- **Live preview**: at most one `MoveLayerCommand` per animation frame goes through history, each
  with the drag's `mergeKey`, so the viewport, the ants and the layer panel follow the drag
  through the usual change events.
- Escape, pointer cancel or window blur mid-drag undo everything the drag did (the move, and any
  lift or commit it started with), unless something else changed the document since. Those
  steps stay on the redo stack.
- Switching to another tool commits a floating selection.

Every frame of a drag recomposites the old and new bounds of what moves, on the CPU. That keeps
up with photo-sized documents (about 35 ms a frame to move a whole 1920 × 1200 layer, 18 ms for
a selection in it), but a whole 6400 × 4000 layer moves at about 3 frames a second. A faster
compositor (an opaque fast path, or a GPU one behind the existing seam) would fix that without
changing the tool.

## Colours and the eyedropper

- The foreground and background colours (`Colors`, `src/ui/color`) are session state, like the
  active tool: not part of the document, never saved and never an undo step. They start black
  and white.
- The toolbar shows them as two overlapping swatches. Clicking one opens a picker
  (`ColorPicker`) that edits it live: a saturation/brightness square and a hue strip drawn on
  canvases, plus hex and R, G, B fields. Enter or a click elsewhere keeps the colour; Escape
  restores the one it had when the picker opened. X swaps the colours and D resets them.
- The Eyedropper (I) sets the foreground colour to the pixel under the pointer as you press
  and drag, or the background colour with Alt held at the press. It samples the composite of
  the visible layers (the default) or the active layer alone, an option (`sampleColor` in
  core). Transparent pixels pick nothing; partly transparent ones give their colour without
  their transparency. Escape mid-drag puts back the colour from before the press.
- Holding Alt turns the Brush or Eraser into the eyedropper (foreground only, with the
  eyedropper's option) until it's released. During a stroke, Alt changes nothing.

## The stroke engine (core)

`src/core/paint` and `src/core/commands/stroke-commands.ts` turn pointer positions into
pixels. They know nothing about tools or the DOM.

- **Dabs**: a `Dab` is a round mark `size` pixels across (1–500), centred anywhere, fractional
  positions included. Its profile is 1 out to hardness × radius, then falls smoothly
  (1 − smoothstep) to 0 at the radius. A pixel's coverage (0–255) is that profile averaged
  across the pixel along the radius (`DabProfile`), so a pixel wholly inside hardness × radius
  is fully covered, and even a 100 % hard dab gets a 1-pixel anti-aliased edge.
- **Spacing**: `DabPlacer` puts a dab at the stroke's first position, then one every
  max(1 px, 10 % of the size) along the straight segments between positions. The distance left
  at the end of one segment carries into the next, so the dabs don't depend on how the
  positions arrive. Pen pressure is interpolated along each segment and scales each dab's size,
  its strength (opacity) or both.
- **Stroke mask**: each stroke has a canvas-sized coverage mask (`StrokeMask`, in 64 px tiles
  made as they're needed). A dab raises it to at most the dab's own coverage: the maximum, not
  a sum. So overlapping dabs within one stroke never paint more than the stroke's opacity, as in
  Photoshop, while the next stroke builds on this one. Dabs stay inside the canvas and the
  selection's bounds (and the layer's, when erasing or painting a floating selection), and
  skip unselected pixels.
- **Opacity semantics**: each pixel under the mask is painted from its value before the stroke,
  with weight p = mask × opacity × selection coverage (each as a fraction of 1). The brush puts
  its opaque colour over the original pixel (straight alpha: alpha becomes 255p + a(1 − p), and
  each channel the alpha-weighted mix of the two). The eraser scales the original alpha by
  1 − p and keeps the colour; a pixel left with no alpha becomes transparent black. The math
  (`paint-math.ts`) is exact integer arithmetic, correctly rounded.
- **Commands**: `beginStroke(doc, layerId, style, floating)` starts a `PaintStroke`, or returns
  null for a missing or hidden layer, a stroke opacity of 0, or nowhere to paint. Each
  animation frame, `strokeCommand(stroke, dabs)` stamps that frame's dabs and returns a
  `StrokeCommand` that repaints just the area they raised (null if they raised nothing);
  execute it straight away. The commands share the stroke's `mergeKey`, so a whole stroke is
  one undo step.
- **Undo**: the stroke keeps the layer's pixels in 64 px tiles, each taken just before the
  stroke first paints it, and undo puts them back exactly. Redo repaints the whole stroke from
  its mask. The selection mustn't change during a stroke; the tool ends the stroke if it does.
- **Growth**: painting past the layer's edges grows the layer to the union of its bounds and
  the painted area (which stays on the canvas), through the same path as merges and commits:
  to the canvas, if the union would exceed 8192 pixels on a side. Erasing never grows a layer,
  and a floating selection doesn't grow either.
- **Change events**: each step dirties the area it painted and lists the layer in
  `layerPixels` (`rect: null` when it grew). Painting a floating selection marks it as edited:
  see [layers.md](layers.md#floating-selections).

## Brush and Eraser

`PaintTool` is both. The Brush (B) paints the active layer with the foreground colour; the
Eraser (E) erases it to transparent, on any layer (there's no special background layer).

- **Options** (`BrushOptions`, one set per tool; the Brush starts at 30 px, the Eraser at 50):
  size 1–500 px (an exponential slider, so small sizes get as much of it as large ones),
  hardness 0–100 % and opacity 1–100 %, each with a number field, and a pen pressure toggle
  that controls size, opacity or both.
- `[` and `]` step the size through 1–10, then 20–100 in tens, then 125, 150, 175, 200, 250,
  300, 400 and 500; Shift+`[` and Shift+`]` step the hardness by quarters. Both flash the new
  value in the status bar.
- A press starts a stroke. Moves queue their positions (coalesced ones included), and the tool
  paints them once per animation frame (`FrameClock`) as one more step of the stroke. Release
  paints what's left: one undo step, "Brush Stroke" or "Eraser Stroke".
- Shift-click draws a straight line from where the tool's last stroke in this document ended.
- Escape, pointer cancel or window blur undo the stroke so far, unless something else changed
  the document since; the stroke stays on the redo stack, as with the Move tool. If something
  else changes the document mid-stroke (an undo, a selection change, another document), the
  stroke ends there.
- Nothing is painted on a hidden layer; the status bar says why. A floating selection can be
  painted, inside its own layer.

Painting a 1920 × 1200 layer at 51 % zoom, with fast strokes covering about 80 document pixels
a frame, took the tool about 1.7 ms a frame with a soft 100 px brush and 4.5 ms with a 300 px
one, compositing included (headless Edge on the development machine), well within a 60 fps
frame.

### Reusing the engine

A new painting tool (a pencil, a clone stamp, a blur brush) reuses as much of this as fits:

1. If it lays down pixels differently, add a value to `StrokeStyle.mode`, its pixel function in
   `paint-math.ts` (exact, with hand-worked tests), and a case in `PaintStroke.render` and the
   stroke's undo label. Dabs, spacing, the mask, selection clipping, undo and growth come with
   it.
2. Drive it with `beginStroke` and `strokeCommand` once per frame as `PaintTool` does, or reuse
   `PaintTool` if it handles input the same way. Its options can reuse `BrushOptions` and
   `BrushOptionsPanel`, and its outline `BrushOverlay`.
3. A tool whose result depends on other pixels (smudge, clone) must read them from the
   stroke's originals, not from pixels the stroke has already changed.

### Open decisions

- **Soft-brush ripple**: with dabs 10 % of the size apart and the mask keeping the maximum, a
  soft stroke's centre line ripples by up to about 3 % of its opacity between dabs. Closer
  spacing for soft brushes, or stamping whole segments analytically, would smooth it out.
- **History memory**: a stroke keeps the 64 px tiles it painted (original pixels and mask,
  20 KB a tile), and one that grows its layer keeps the old layer whole.
- **Eyedropper**: in its active-layer mode it samples the layer even while it's hidden.
- **Shift while painting** only matters at the press (a straight line); it doesn't constrain
  a drag to an axis.

## Fill, Clear and the Paint Bucket

Edit → Fill… and Clear, their shortcuts and the Paint Bucket all change the active layer's
pixels through two core commands in `src/core/commands/fill-commands.ts`.

### The commands (core)

- **`fillCommand(doc, layerId, color, opacity, mode, { region, floating, label })`** fills
  with an opaque colour. Each pixel's weight is p = region coverage × selection coverage ×
  opacity, each as a fraction of 1; without a selection the whole canvas counts as selected,
  and without a `region` (the Paint Bucket's flood region) so does all of it. In `normal`
  mode the colour goes over the pixel as the brush paints it (alpha becomes 255p + a(1 − p),
  each channel the alpha-weighted mix). `preserve-transparency` moves each channel of a pixel
  that has some alpha towards the colour by p and leaves its alpha alone; transparent pixels
  stay transparent. The pixel math is the stroke engine's (`paint-math.ts`), exact and
  correctly rounded.
- **`clearCommand(doc, layerId, floating)`** clears the selected pixels to transparency,
  weighted by coverage c: alpha becomes a(1 − c / 255) and the colour stays, and a pixel
  cleared completely becomes transparent black, as the eraser leaves it. It needs a selection.
- Both cover only the smallest rect holding every pixel they change (`paintedArea`), and are
  null when that's nothing: a missing or hidden layer, no selected pixel in the region, an
  opacity of 0, or (preserving transparency, or clearing) no selected pixel with any alpha.
- **Growth**: a normal fill that reaches past the layer's edges grows the layer to the union
  of its bounds and the filled area, as painting does (`growthArea`: to the canvas if that
  union would exceed 8192 pixels on a side). So a fill with no selection grows a layer smaller
  than the canvas to cover it. Preserving transparency and clearing never grow a layer.
- **Undo**: the pixels the fill or clear replaced (`PixelSnapshot`), or the whole layer as it
  was if it grew, come back exactly. `layerPixels` lists the layer with the rect it changed,
  or `rect: null` if it grew.
- **Floating selections**: on the floating layer, both stay within its bounds (it doesn't
  grow) and mark it as edited, like a brush stroke, so committing it in place keeps the change.

### Edit menu and shortcuts

`runFill` and `runClear` (`src/ui/edit-actions.ts`) back the Edit menu and the shortcuts. They
act on the active layer and do nothing while it's hidden. While a selection floats its layer
is the active one, so they change the floating layer rather than committing it.

| Keys (Mac)                                 | Action                                    |
| ------------------------------------------ | ----------------------------------------- |
| Alt+Backspace (Option+Delete)              | fill with the foreground colour           |
| Ctrl+Backspace (Cmd+Delete)                | fill with the background colour           |
| Shift added to either                      | the same, preserving transparency         |
| Shift+Backspace (Shift+Delete)             | open the Fill dialog                      |
| Delete or Backspace (delete, or fn+delete) | clear the selected pixels to transparency |

- `editShortcutFor` maps a key press. Backspace and the forward Delete key work alike, since
  the Mac's delete key types Backspace. Ctrl+Alt (AltGr on Windows) and Cmd+Option match
  nothing. The shortcut fills are at 100 % opacity in Normal mode, as in Photoshop.
- `useEditShortcuts` calls `preventDefault` on all of them, so the browser does nothing else
  with them. They're ignored while typing in a text field, while a dialog is open or a file
  operation runs, and for a key the active tool used; held keys don't repeat.
- The Edit menu has Undo and Redo (named after the step), Fill… and Clear; Cut, Copy and
  Paste will go between them. Fill… is enabled while the active layer is visible, and Clear
  while the selection's bounds reach the visible active layer (a quick check: Clear may then
  find nothing with any alpha to clear, and adds no step). Menu shortcuts without Ctrl/Cmd
  are marked `plain` and show as Shift+Backspace and Delete, or ⇧⌫ and ⌫ on a Mac.
- **Fill dialog**: Contents (Foreground colour, Background colour, Black, White, 50% grey,
  which is 128, 128, 128, or Custom colour with a colour picker that selects it when changed),
  Opacity (1–100 %) and Preserve transparency. A hint says whether the selection or the whole
  canvas will be filled. It remembers its settings for the session (`AppController`), and a
  custom colour starts as the foreground colour. One undo step, "Fill".

### Paint Bucket

`PaintBucketTool` (G) fills with a click: the flood region around the pixel clicked
(`regionAt`, as for the Magic Wand) gets the foreground colour on the active layer, at the
options' opacity, in Normal mode and within the selection: `fillCommand` with the region.

- **Options** (`RegionOptions`, the bucket's own set): tolerance (default 32), contiguous (on),
  anti-alias (on), sample all layers (off) and opacity 1–100 % (100).
- With anti-alias, the region's 1-pixel soft edge (see [Flood regions](#flood-regions-core))
  is filled in part, so the fill blends into an anti-aliased outline rather than leaving a
  halo of the old colour.
- With "sample all layers", the region comes from the composite but the fill still goes on
  the active layer. A region past the layer's edges grows it, as a fill does.
- One undo step per click ("Paint Bucket"); a click that would change nothing (off the canvas,
  or a region the selection doesn't reach) adds none. Nothing is filled on a hidden layer,
  and the status bar says why. A floating selection's layer is filled within its bounds and
  marked as edited.

### Open decisions

- **Growth**: a fill grows its layer to the union of its bounds and the filled area, like a
  brush stroke, rather than always to the whole canvas.
- **Matching** compares each channel with the clicked pixel's (no perceptual distance, no
  running average), and treats every fully transparent pixel alike.
- **Mid-gesture**: like undo and the other shortcuts, the Edit shortcuts aren't blocked
  during a drag.
- **Hybrid lasso**: only the freehand Lasso switches to straight segments with Alt; the
  Polygonal Lasso doesn't switch to freehand.

## Crop tool

`CropTool` (C) crops the canvas to a box with `cropCommand` ([transform.md](transform.md)). The
box is session state: it starts as the selection's bounds when the tool becomes active, and
goes away when the tool does, or when the document is replaced or changes size.

- **Drawing**: dragging outside the box, or anywhere with no box, draws a new one, corners
  snapped to whole pixels, at least 1 × 1. It may reach past the canvas, which cropping then
  enlarges with transparent space.
- **Adjusting**: a press within 6 CSS px of an edge (`HANDLE_REACH`), anywhere along it, drags
  that edge, or near a corner both edges; inside that, a press moves the box. An edge reaches
  in at most a third of the box, so even a small box keeps a middle to move it by. Dragging an
  edge past the opposite one flips the box, and the cursor shows what a press would do. A drag
  takes hold after 3 CSS px of travel; a click changes nothing.
- **Shift and Alt**: in Free, Shift keeps the box square while drawing and keeps its shape
  while resizing. Alt draws or resizes from the centre. Pressing or releasing either mid-drag
  updates the box straight away.
- **Ratio** (options bar): Free, Original (the image's), 1:1, 4:3, 3:2, 16:9 or Custom W:H
  (terms up to 10000, decimals allowed). Original and the presets fit a portrait box as well as
  a landscape one: the drag's direction decides while drawing, the box's shape while resizing.
  1:1 and Custom are exact. Dragging an edge with a ratio sets the other side about its centre.
  Changing the ratio reshapes the box about its centre, keeping its area and orientation.
- **Delete cropped pixels** (off by default) trims every layer to the new canvas. Off, layers
  keep the pixels outside it, which come back if the canvas grows again.
- **Committing**: Enter, a double-click inside the box or the options bar's ✓ crops, as one
  undo step ("Crop") after committing a floating selection; Escape or ✗ removes the box. A box
  over 8192 pixels on a side is refused with a message. Escape mid-drag, pointer cancel and
  window blur put back the box from before the press.

The status bar shows the box's size, and the grid shows while a drag adjusts the box (see
[Drawing](#drawing)). `crop-geometry.ts` holds the box arithmetic, tested on its own.

## Adding a tool

1. Implement `Tool` in `src/ui/tools/`, using a key from `TOOL_KEYS`.
2. Express every edit as a core command with tests; pixel edits clip to the selection and
   commit a floating selection first if they would change its source. Painting tools get the
   clipping from the stroke engine, and filling ones from `fillCommand`; both change only the
   active layer, which while a selection floats is the floating layer, never its source.
3. Add the tool in `createToolManager` and give it an icon in `ToolPicker`.
4. Unit-test pointer sequences against `FakeViewport` (`fake-viewport.ts`) and, for tools that
   work per animation frame, `FakeClock` (`fake-clock.ts`), as `marquee-tool.test.ts`,
   `lasso-tool.test.ts`, `move-tool.test.ts`, `paint-tool.test.ts` and `crop-tool.test.ts` do.
