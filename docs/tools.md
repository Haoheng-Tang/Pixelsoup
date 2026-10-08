# Tools and selections

How editing tools plug into the viewport, and how selections work. The code lives in
`src/core/selection.ts` (masks), `src/ui/tools` (tools) and `src/ui/viewport` (input routing and
drawing).

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
  Lifting a floating selection weights the pixels it cuts out the same way. Layer properties
  such as opacity and visibility, and whole-layer operations (moving, merging, flattening,
  committing a floating selection), aren't pixel edits and ignore the selection.

## The `Tool` interface

| Member                          | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`, `name`                    | stable ID (`rect-marquee`) and display name (`Rectangular Marquee`)                                          |
| `shortcut`                      | a key from `TOOL_KEYS`                                                                                       |
| `cursor`                        | CSS cursor over the canvas                                                                                   |
| `OptionsPanel?`                 | React component shown in the tool-options bar                                                                |
| `overlay?`                      | shape to preview (`rect` or `ellipse`, document coordinates); `hidesSelection` hides the selection meanwhile |
| `activate(ctx)`, `deactivate()` | `ctx` gives the `Editor` and `overlayChanged()`, to call whenever `overlay` changes                          |
| `pointerDown/Move/Up(e)`        | `e.x`, `e.y`: fractional document coordinates (pixel (px, py) spans [px, px + 1)); plus `zoom` and modifiers |
| `cancel()`                      | abandon the gesture in progress without committing it                                                        |
| `keyDown/keyUp(e)`              | return true if the key was used, so the viewport suppresses the browser's default action                     |

Tools are UI and never mutate the document directly: every change is a core command run through
`editor.history`. A gesture that should be one undo step either commits once at the end (the
marquee) or gives its commands a shared `mergeKey` (the Move tool, later the brush).

## ToolManager and input routing

- `ToolManager` holds the tools and the active one; `createToolManager` (in `create-tools.tsx`)
  builds the app's set in toolbar order. Activating a tool cancels and deactivates the old one,
  and is refused while a pointer gesture is in progress.
- Shortcuts (`useToolShortcuts`): tools that share a key form a group. The key selects the
  group's last-used tool and Shift+key cycles through it. They're ignored with Ctrl, Cmd or Alt,
  while typing and while a dialog is open. `TOOL_KEYS` has M marquee and V move, and reserves
  B brush, L lasso, W wand, T text and C crop.
- The viewport handles panning (Space+drag, middle button) and wheel zoom itself, first. Other
  primary-button presses go to the tool, with pointer capture; moves with no button down are
  forwarded as hover. If the view changes mid-gesture, the viewport re-sends the pointer so the
  tool sees its new document position.
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
- A selection with no pixel at 50 % coverage or more has no outline.
- A floating selection on the move is a new selection each frame it moves, so its outline is
  traced again each time (about 7 ms for a 2000 × 1500 selection). Reusing the cached path with
  an offset would be cheaper, except where the canvas edge clips the selection.

The status bar shows the document pixel under the pointer and the size of the tool's preview
(while dragging) or of the selection bounds. The viewport reports both and `StatusBar` writes them
straight into the DOM.

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

## Adding a tool

1. Implement `Tool` in `src/ui/tools/`, using a key from `TOOL_KEYS`.
2. Express every edit as a core command with tests; pixel edits clip to the selection and
   commit a floating selection first if they would change its source.
3. Add the tool in `createToolManager` and give it an icon in `ToolPicker`.
4. Unit-test pointer sequences against `FakeViewport` (`fake-viewport.ts`), as
   `marquee-tool.test.ts` and `move-tool.test.ts` do.
