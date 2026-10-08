# Tools, selections and painting

How editing tools plug into the viewport, how selections work, and how the painting tools
paint. The code lives in `src/core/selection.ts` (masks), `src/core/paint` and
`src/core/commands/stroke-commands.ts` (the stroke engine), `src/ui/tools` (tools),
`src/ui/color` (colours) and `src/ui/viewport` (input routing and drawing).

## Selections (core)

- `Selection` is an immutable 8-bit coverage mask the size of the canvas: 0 is unselected, 255
  fully selected, values in between partly selected (anti-aliased edges). It caches its bounding
  rect (`bounds()`, null when empty) and `isEmpty`.
- Build one with `Selection.fromRect`, `fromEllipse` (exact anti-aliased edge coverage),
  `selectAll`, `empty` or `fromMask`. Combine with `union` (max), `subtract` (min(a, 255 − b)),
  `intersect` (min) and `invert` (255 − a); move with `translate(dx, dy)` (whole pixels;
  coverage moved off the canvas is lost); read with `coverageAt(x, y)` (0 off the canvas) and
  `equals`. Every operation returns a new selection.
- `combineSelections(base, shape, mode)` applies a tool's mode (`replace`, `add`, `subtract`,
  `intersect`) and returns null when nothing ends up selected.
- `doc.selection` is null or a non-empty selection. `SetSelectionCommand` changes it, also
  through `selectAllCommand`, `deselectCommand` and `invertSelectionCommand` (null when they
  would change nothing). It reports the old and new bounds as `DocumentChange.selectionDirty`
  with no pixel `dirty` rect, and sets `changesContent: false`: selection changes are undo steps
  but don't make the document unsaved, because selections aren't saved in `.pixelsoup` files.
  The only other command that changes it is a `MoveLayerCommand` given a `selection`: moving a
  floating selection moves its outline in the same step.
- **Clipping invariant.** Every pixel-editing command clips to `doc.selection` when it isn't
  null, treating coverage as a per-pixel weight: `result = old + (new − old) × coverage / 255`.
  Lifting a floating selection weights the pixels it cuts out the same way, and brush and
  eraser strokes multiply each pixel's paint weight by its coverage / 255. Layer properties
  such as opacity and visibility, and whole-layer operations (moving, merging, flattening,
  committing a floating selection), aren't pixel edits and ignore the selection.

## The `Tool` interface

| Member                          | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`, `name`                    | stable ID (`rect-marquee`) and display name (`Rectangular Marquee`)                                          |
| `shortcut`                      | a key from `TOOL_KEYS`                                                                                       |
| `cursor`                        | CSS cursor over the canvas; it may change, like `overlay`                                                    |
| `OptionsPanel?`                 | React component shown in the tool-options bar                                                                |
| `overlay?`                      | what to draw over the document (`ToolOverlay`, document coordinates): a marquee shape or a brush outline     |
| `activate(ctx)`, `deactivate()` | `ctx` gives the `Editor`, `overlayChanged()` (call when `overlay` or `cursor` changes) and `showMessage()`   |
| `pointerDown/Move/Up(e)`        | `e.x`, `e.y`: fractional document coordinates (pixel (px, py) spans [px, px + 1)); plus `zoom` and modifiers |
| `cancel()`                      | abandon the gesture in progress without committing it                                                        |
| `keyDown/keyUp(e)`              | return true if the key was used, so the viewport suppresses the browser's default action                     |
| `stepBrush?(property, dir)`     | painting tools: `[` and `]` step the brush size down and up, with Shift its hardness                         |

- **Overlays**: a `ShapeOverlay` (`rect` or `ellipse`) previews a marquee; `hidesSelection`
  hides the selection's outline meanwhile. A `BrushOverlay` (`brush`, with a centre and a
  diameter) is a painting tool's outline.
- **Pointer events** from a pen carry its `pressure` (0–1; mice and touch report none). A move
  also lists every position the browser coalesced into it since the previous event
  (`samples`, oldest first, ending at `x`, `y`), so fast strokes keep their shape.
- **`showMessage(text)`** flashes text in the status bar for 1.5 s, e.g. a new brush size.

Tools are UI and never mutate the document directly: every change is a core command run through
`editor.history`. A gesture that should be one undo step either commits once at the end (the
marquee) or gives its commands a shared `mergeKey` (the Move tool and the painting tools).

## ToolManager and input routing

- `ToolManager` holds the tools and the active one; `createToolManager` (in `create-tools.tsx`)
  builds the app's set in toolbar order. Activating a tool cancels and deactivates the old one,
  and is refused while a pointer gesture is in progress.
- Shortcuts (`useToolShortcuts`): tools that share a key form a group. The key selects the
  group's last-used tool and Shift+key cycles through it. They're ignored with Ctrl, Cmd or Alt,
  while typing and while a dialog is open. `TOOL_KEYS` has M marquee, V move, B brush, E eraser
  and I eyedropper, and reserves L lasso, W wand, T text and C crop.
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
  canvas has focus. Escape during a gesture cancels it, as do pointer cancel, window blur, a
  tool switch and a document swap.

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
- The tool's preview shape is drawn the same way; it's rebuilt each draw, which is cheap.
- A painting tool's brush outline is a circle in document space, so it scales with the zoom:
  a `--cursor-line` line over a wider `--cursor-halo` one, so it shows on any colour. Smaller
  than 4 CSS px across, it becomes a crosshair on the device pixel grid. It shows only while the
  pointer is over the canvas (or during a stroke) and not while panning; the tool's own CSS
  cursor is `none` meanwhile.
- A selection with no pixel at 50 % coverage or more has no outline.
- A floating selection on the move is a new selection each frame it moves, so its outline is
  traced again each time (about 7 ms for a 2000 × 1500 selection). Reusing the cached path with
  an offset would be cheaper, except where the canvas edge clips the selection.

The status bar shows the document pixel under the pointer and the size of the tool's preview
(while dragging) or of the selection bounds. The viewport reports both and `StatusBar` writes them
straight into the DOM, as it does the tools' `showMessage` text.

## Marquee tools

`MarqueeTool` comes as the Rectangular and Elliptical Marquee, sharing M (Shift+M switches).

- Drag from corner to corner; both ends snap to the nearest pixel corner. In New mode the live
  preview hides the current selection's outline.
- The mode comes from the options bar (New, Add, Subtract, Intersect; shared by both marquees),
  overridden at the press when a selection exists: Shift adds, Alt subtracts, Shift+Alt
  intersects.
- During the drag Shift constrains to a square or circle (the longer side wins) and Alt draws
  from the centre. A modifier that picked the mode at the press only constrains after it has
  been released and pressed again. With no selection, modifiers held at the press constrain
  straight away.
- Releasing commits one undo step named after the tool, unless the selection wouldn't change. A
  click (less than 3 CSS pixels of travel) or a shape entirely off the canvas deselects in New
  mode and does nothing in the other modes.
- A floating selection is committed first whenever the selection changes, as one more step.

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

## Adding a tool

1. Implement `Tool` in `src/ui/tools/`, using a key from `TOOL_KEYS`.
2. Express every edit as a core command with tests; pixel edits clip to the selection and
   commit a floating selection first if they would change its source. Painting tools get the
   clipping from the stroke engine, and paint only the active layer, which while a selection
   floats is the floating layer, never its source.
3. Add the tool in `createToolManager` and give it an icon in `ToolPicker`.
4. Unit-test pointer sequences against `FakeViewport` (`fake-viewport.ts`) and, for tools that
   work per animation frame, `FakeClock` (`fake-clock.ts`), as `marquee-tool.test.ts`,
   `move-tool.test.ts` and `paint-tool.test.ts` do.
