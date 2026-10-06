# feat: selection masks, the tool system and marquee tools

## Summary

Step 5 of the build order. Pixelsoup now has selections and the tool system every later tool
(move, brush, lasso, wand, text, crop) will plug into.

- **Selections in core**: an immutable 8-bit coverage mask the size of the canvas, with rect,
  anti-aliased ellipse, union, subtract, intersect, invert and select-all operations, and an
  undoable `SetSelectionCommand`.
- **Tool system in `src/ui`**: a `Tool` interface, a `ToolManager`, tool buttons with shortcut
  badges in the toolbar, and a tool-options bar under it. The viewport routes pointer and key
  input to the active tool; panning and zooming keep priority.
- **Rectangular and Elliptical Marquee** (M, Shift+M switches): drag to select, with New, Add,
  Subtract and Intersect modes from the options bar or from Shift/Alt at the press, Shift to
  constrain to a square or circle and Alt to draw from the centre. A click deselects; Esc
  cancels.
- **Select menu**: Select All (Ctrl/Cmd+A), Deselect (Ctrl/Cmd+D), Inverse (Ctrl/Cmd+Shift+I).
- **Marching ants** on an overlay canvas, crisp and exactly aligned at every zoom and pan.
- **Status bar** with the pointer's document position and the selection (or drag) size.

Selection changes are undo steps, as in Photoshop, but don't mark the document unsaved:
selections aren't stored in `.pixelsoup` files.

## What's included

Commits are meant to be reviewed one at a time:

1. **Selection masks and `SetSelectionCommand`** (core):
   - `Selection`: `empty`, `selectAll`, `fromRect`, `fromEllipse`, `fromMask`; `union`,
     `subtract`, `intersect`, `invert`; `bounds()` (cached when the selection is made),
     `isEmpty`, `coverageAt(x, y)` and `equals`. Every operation returns a new selection.
   - Set operations treat coverage as fuzzy membership: union is max, intersect is min,
     subtract is min(a, 255 − b), invert is 255 − a. They're exact for hard masks and keep
     anti-aliased edges smooth.
   - Ellipse coverage is exact along each row and sampled on 16 sub-rows per pixel.
   - `combineSelections(base, shape, mode)` applies a tool's mode.
   - `SetSelectionCommand(selection, label, mergeKey?)` stores an empty selection as null, so
     `doc.selection` is always null or non-empty. It reports old ∪ new bounds in the new
     `DocumentChange.selectionDirty`, with no pixel `dirty` rect. A drag can pass one
     `mergeKey` to make a single undo step.
   - `selectAllCommand`, `deselectCommand`, `invertSelectionCommand` return null when they
     would change nothing.
   - `Command.changesContent` (default true): `LinearHistory` keeps the current `stateId` for
     commands that set it to false, so selection changes are undoable but leave the save point
     alone.
2. **`Tool` interface and `ToolManager`** (`src/ui/tools`):
   - A tool has an ID, name, shortcut key, cursor, an optional options panel and preview
     overlay, activate/deactivate hooks, pointer handlers that get fractional document
     coordinates plus zoom and modifiers, `cancel()`, and key handlers that say whether they
     used the key.
   - `TOOL_KEYS` reserves V, B, L, W, T and C for later tools. Tools sharing a key form a group:
     the key picks the group's last-used tool and Shift+key cycles through it.
   - The manager tracks the pointer gesture, refuses tool switches during it, cancels it on
     Escape or when the document is replaced, and forwards overlay changes.
3. **Marching ants**:
   - `traceSelectionOutline` (core) walks the edges between pixels on either side of 50 %
     coverage into closed loops; pixels that only touch diagonally get separate loops.
   - `SelectionOverlay` turns the loops into one document-space `Path2D`, cached per selection.
     Pan and zoom change only the transform; each frame changes only the dash offset. The
     animation loop runs only while ants are visible.
   - Lines are `round(devicePixelRatio)` device pixels wide and use the composite's own
     device-pixel snapping, so they sit exactly on the pixel edges.
4. **`assertNever` refactor**: `combineSelections` uses the shared helper.
5. **`MenuButton`**: the WAI-ARIA menu button is pulled out of `FileMenu` into a generic
   component, unchanged in behaviour, so the Select menu can reuse it.
6. **Select menu and shortcuts**: Select All, Deselect and Inverse, disabled when they'd do
   nothing or while a dialog or file operation is running. The shortcuts call
   `preventDefault`, so Ctrl+A doesn't select the page.
7. **Marquee tools, tool picker, options bar, status bar and viewport routing**:
   - `MarqueeTool` (rect or ellipse) and a `SelectionOptions` mode shared by both marquees.
   - The viewport handles panning (Space+drag, middle button) and wheel zoom first. Other
     primary-button presses go to the tool, with pointer capture, and moves with no button
     down are forwarded as hover.
   - If the view changes mid-gesture, the viewport re-sends the pointer so the preview stays
     under the cursor.
   - Keys reach the tool during a gesture, while the pointer is over the canvas, or while the
     canvas has focus.
   - Pointer cancel, window blur, a tool switch and a document swap cancel the gesture.
   - Cursor priority: grabbing, grab (Space held, no gesture), then the tool's cursor.
   - `StatusBar` writes the readouts straight into the DOM, like the zoom %.
8. **Docs**:
   - New `docs/tools.md`, imported from `CLAUDE.md`: selections, the `Tool` interface, input
     routing, drawing, the marquee rules and how to add a tool.
   - `CLAUDE.md` marks step 5 done and states the selection-clipping invariant. It stays at 199
     lines.
   - The README lists the features and the selection shortcuts.

## Design notes

- **Clipping invariant** (in `CLAUDE.md`): every future pixel-editing command clips to
  `doc.selection` when it isn't null, weighting each pixel by coverage:
  `result = old + (new − old) × coverage / 255`. Layer properties such as opacity and visibility
  aren't pixel edits and ignore the selection.
- **Modifier latching**:
  - With a selection, Shift, Alt or both at the press choose Add, Subtract or Intersect.
  - A key that chose the mode only starts constraining (square/circle, from centre) after it's
    released and pressed again, so Shift-adding doesn't force a square.
  - With no selection, modifiers held at the press constrain straight away.
- **Pixel-exact geometry**: both drag ends snap to the nearest pixel corner. A drag needs 3 CSS
  pixels of travel, so a click at any zoom deselects (in New mode) instead of making a sliver.
- **Two marquee tools rather than one with a shape option**: each gets its own button, icon,
  cursor and undo label, and the same key-group mechanism will serve lasso variants later.
- **The commit is a single step on pointer-up** rather than a `mergeKey` stream, so the drag
  only touches history once and an Escape leaves nothing behind. `mergeKey` is ready for tools
  that edit as they go (brush).
- **The outline is traced once per selection**, never on pan, zoom or animation frames. At
  fractional device scales that trades a little softness for not rebuilding the path.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 221 tests across 20 files (84 new)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:5173
```

Unit tests cover:

- **Mask operations** on small hand-built masks: rect clipping and rounding, ellipse coverage at
  known pixels, union, subtract, intersect and invert values, bounds, emptiness, immutability.
- **`SetSelectionCommand`**: apply, revert, merging, empty-to-null, size checks and dirty rects.
  The menu-command helpers and the history save point are covered too.
- **Outline tracing**: a 3×3 square is one closed loop of 12 edges, a region with a hole is two
  loops, plus diagonal neighbours, a vertex visited twice and the 50 % threshold.
- **`ToolManager`**: activation, groups and Shift cycling, routing, Escape, switch refusal
  mid-gesture, cancel on document replace, overlay forwarding.
- **Marquee tools**: 23 pointer sequences against a fake viewport, covering each mode and
  modifier combination, latching, square and centre constraints, click to deselect, Escape,
  zoom-dependent click tolerance and one undo step per drag.

In the browser:

- [ ] M selects the Rectangular Marquee; Shift+M switches to the Elliptical one and back. The
      options bar shows the tool and its mode buttons.
- [ ] Drag a rectangle and an ellipse at several zoom levels (e.g. 50 %, 100 %, 400 %, 1600 %):
      the ants sit exactly on the pixel edges and the status bar shows the size while dragging.
- [ ] With a selection, Shift-drag adds, Alt-drag subtracts and Shift+Alt-drag intersects. The
      options bar's Add, Subtract and Intersect buttons do the same without modifiers.
- [ ] Press Shift during a drag for a square or circle, and Alt to grow from the centre.
- [ ] A click without dragging deselects; Esc during a drag cancels it.
- [ ] Select → Select All, Deselect and Inverse, and Ctrl+A, Ctrl+D and Ctrl+Shift+I, work;
      Ctrl+A doesn't highlight the page.
- [ ] Ctrl+Z and Ctrl+Shift+Z step through every selection change. The ● unsaved marker
      doesn't appear for selection changes alone.
- [ ] Space+drag, middle-drag and the wheel pan and zoom without changing the selection. The ants
      stay crisp and follow the canvas, including when zooming mid-drag.
- [ ] With a selection active, change a layer's opacity: it updates, undoes and keeps the
      selection.
- [ ] Tool shortcuts and the Select menu are inactive while a dialog is open.

These checks were run in a Chromium browser at 125 % display scaling, with scripted pointer and
key events and by hand.

## Known limitations

- **Fractional device scales**: where pixel edges fall between device pixels (such as 100 %
  zoom on a 125 % display) the ants are anti-aliased across two device pixels instead of one.
  This follows from not rebuilding the outline on zoom.
- **Line width**: ants are `round(devicePixelRatio)` device pixels, so not exactly 1 CSS pixel
  on fractionally scaled displays.
- **Faint selections**: a selection with no pixel at 50 % coverage or more has no ants, though it
  still exists and can be deselected or inverted.
- **Browser-reserved shortcuts**: some browsers keep Ctrl/Cmd+Shift+I (developer tools) or
  Ctrl/Cmd+D (bookmark) for themselves. The Select menu always works.
- **Memory**: a selection is a full-canvas mask, one byte per pixel (about 2 MB at 1920×1080,
  64 MB at 8192×8192). Masks are shared, not copied, but history keeps every one it needs, up to
  the 200-step cap. This belongs with the existing "history storage" open decision.
- **Main-thread work**: building, combining and tracing masks run on the main thread. That's
  fine at the default size but may be noticeable on very large canvases.

## Deliberately out of scope

- **Pixel edits that clip to the selection**: there are none yet. The invariant is documented
  for the move tool, brush and adjustments.
- **Lasso and magic wand** (step 10); the L and W keys are reserved.
- **Selection refinements**: feather, grow/shrink, border, moving or transforming the selection
  outline, fixed-ratio or fixed-size marquees, and an anti-alias toggle for the ellipse.
- **Saving the selection** in `.pixelsoup` files; the format is unchanged.
- **Reserved tools in the toolbar**: V, B, L, W, T and C get buttons when their tools exist.
