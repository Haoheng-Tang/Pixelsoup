# feat: the Move tool and floating selections

## Summary

Step 6 of the build order. The Move tool (V) is Pixelsoup's first pixel-editing feature, and it
lays the undo foundation the brush will reuse.

- **Move layers**: drag the active layer anywhere, even off the canvas. Shift keeps the drag to
  one axis. The arrow keys nudge by 1 px (10 with Shift), and a quick run of nudges is one undo
  step.
- **Move selected pixels**: with a selection, the first drag lifts the selected pixels out of the
  active layer into a floating selection and moves them with their outline. Coverage weights the
  lift, so soft edges come along. Alt copies instead of cutting.
- **Floating selections** are session state, like the active layer. Layer → Commit Floating
  Selection (Ctrl/Cmd+Enter) drops one back into its layer, and so do selecting, deselecting,
  switching tools or layers, adding a layer, merging, flattening, saving and exporting. Lifting
  and committing without a move leaves the layer bit-identical, and undoing a commit floats the
  pixels again.
- **Pixel-edit undo foundation**: `PixelSnapshot` copies just the layer-space rect a command is
  about to change and puts it back on undo. It's now the standard pattern for pixel commands.
- **`Selection.translate(dx, dy)`**, clipped to the canvas, so the marching ants follow moving
  pixels.

A floating selection is never saved: Save commits it first. The `.pixelsoup` format is unchanged.

## What's included

Commits are meant to be reviewed one at a time:

1. **`PixelSnapshot` and `Selection.translate`** (core):
   - `PixelSnapshot.capture(buffer, rect)` copies a rect of a buffer, clipped to it, and
     `restore(buffer)` writes exactly those bytes back, leaving the rest alone. Restoring into a
     buffer of another size throws.
   - `Selection.translate(dx, dy)` moves coverage and the cached bounds by whole pixels. Coverage
     moved off the canvas is dropped, and the bounds are rescanned when the canvas clips them.
2. **`MoveLayerCommand` and nudge grouping**:
   - `MoveLayerCommand(layerId, x, y, { label, mergeKey, selection })` sets a layer's offset in
     whole pixels, anywhere, off the canvas included. It dirties the old and new bounds on the
     canvas and lists nothing in `layerPixels`, as no pixels change.
   - Moves of the same layer with the same `mergeKey` merge into one undo step.
   - The optional `selection` replaces `doc.selection` in the same step (`selectionDirty`), so a
     floating selection's outline moves with it.
   - `moveLayerCommand(...)` is null for a missing layer, or when neither the position nor the
     selection would change.
   - `src/ui/tools/nudge.ts`: `nudgeOffset` maps the arrow keys to 1 px, or 10 with Shift.
     `NudgeGrouper` gives a nudge less than `NUDGE_MERGE_MS` (1 s) after the previous one the
     same merge key.
3. **Floating selections: lift and commit** (core):
   - `LiftSelectionCommand` ("Lift Selection", or "Copy Selection") cuts or copies the selected
     pixels into a new "Floating selection" layer directly above the source, the size of the
     selection's bounds. A `PixelSnapshot` of the cut rect lets undo restore the exact bytes;
     redo cuts again from them.
   - `CommitFloatingCommand` ("Commit Floating Selection") merges the floating layer into its
     source and removes it:
     - committed where it was lifted, it restores the snapshot (a copy changes nothing);
     - moved within the source's bounds, it composites with `compositeLayers` (the merge-down
       math) and snapshots the changed rect before and after;
     - moved past the source's edges, the source grows as with Merge Down (`mergeArea`, now
       shared), and history keeps both buffers.
   - Both commands report the new `DocumentChange.floating` and list the source in `layerPixels`
     when they change its pixels. `liftSelectionCommand` is null without a selection or when the
     selection misses the layer; `commitFloatingCommand` is null unless the floating layer is
     directly above its source.
   - `FloatingSelection` (`floating-selection.ts`) records the floating layer, its source, the
     selection and position as lifted, and the snapshot of what was cut.
   - `Editor.floating` and `commitFloating()`: the editor takes the floating selection from each
     change, so undo and redo bring it back, and drops it if its layer stops being directly above
     its source or the document is replaced. While it exists, its layer is active, and making
     another layer active commits it first. Subscribers see `floatingChanged`.
4. **A floating selection looks like its source**: the floating layer takes the source's opacity,
   visibility and blend mode, so lifting from a translucent layer doesn't make the pixels jump to
   full opacity. Committing merges them at full strength into the source's own pixels, and the
   source keeps its properties.
5. **The Move tool** (`move-tool.ts`) and its UI:
   - A V button with a four-way arrow icon, the `move` cursor everywhere, and an options bar that
     explains the modifiers.
   - A drag takes hold after 3 CSS px (the marquee's click tolerance). It moves the floating
     selection; else the active layer's selected pixels, lifted (copied with Alt); else, with
     nothing selected, the whole active layer. Nothing moves if the active layer is hidden or the
     selection misses it.
   - While dragging, at most one `MoveLayerCommand` per animation frame goes through history, all
     with the drag's merge key. The clock is injectable, so tests run frames by hand.
   - Shift keeps to the axis moved furthest along, updating as Shift goes down or up. Arrow keys
     nudge, and Alt+arrow copies like Alt+drag. Undo steps are named Move Layer, Move Selection,
     Nudge Layer or Nudge Selection.
   - Alt+dragging a floating selection commits it and drags a copy.
   - Escape, pointer cancel and window blur undo what the drag did: the move, and any lift or
     commit it started with.
   - Commit points:
     - switching to another tool;
     - the Select menu and its shortcuts, and a marquee that would change the selection;
     - Save, Save As and Export, after the file picker;
     - Layer → Commit Floating Selection and Ctrl/Cmd+Enter (a new `commit-floating` layer
       action), and Merge Down; New Layer and Flatten Image commit first.
   - While a selection floats, Duplicate, Delete and Move Layer Up/Down are disabled, as they'd
     separate the floating layer from its source or copy it. Its row shows "Floating selection"
     in italics and can't be renamed, dragged, hidden or faded.
   - `FakeViewport` moved out of `marquee-tool.test.ts` into `fake-viewport.ts`, with held
     modifiers and key presses, for both tools' tests.
6. **Commit before the source is hidden or faded** (found while testing by hand): the source's eye
   button and opacity slider changed it while its floating layer kept the old look.
   `commitFloatingFrom(editor, layerId)` now commits first, as an undo step of its own; a drag of
   the slider is still one opacity step.
7. **Docs**:
   - `docs/tools.md`: `translate`, the selection moves of `MoveLayerCommand`, lifting under the
     clipping invariant, and a new "Move tool" section (behaviour, nudges, live preview,
     cancelling, speed). "Adding a tool" says to commit a floating selection before changing its
     source, and points at `FakeViewport`.
   - `docs/layers.md`: the move, lift and commit commands with their dirty rects and
     `layerPixels`, a new "Floating selections" section, the floating row, Ctrl/Cmd+Enter, and
     open decisions on how a floating selection looks.
   - `CLAUDE.md` marks step 6 done and records the `PixelSnapshot` pattern for pixel edits. The
     history-storage open decision now points at tiled snapshots behind `PixelSnapshot`. It stays
     at 199 lines.
   - The README lists the Move tool and has a Move tool shortcuts table.

## Design notes

- **One undo pattern for pixel edits**: a pixel command snapshots only the layer-space rects it
  is about to change, before its first write. Undo restores the snapshot; redo recomputes the
  edit from the restored pixels (the lift) or restores an after-snapshot (the commit). History
  grows with the edited area rather than the layer, and tiled storage can go behind
  `PixelSnapshot` later.
- **Coverage weighting**: a pixel with alpha a and coverage c lifts alpha round(a × c / 255),
  and the source keeps the rest, with colours unchanged (straight alpha). That's the clipping
  invariant applied to a cut: the source keeps `old × (1 − c / 255)`. There are no .5 ties
  (2·a·c is even, 255 is odd), so both parts are correctly rounded.
- **Bit-identical round trips**: compositing the two parts of a partly selected pixel back
  together doesn't give the original (an opaque pixel at half coverage comes back about
  three-quarters opaque). So a floating selection committed where it was lifted restores the
  snapshot instead of compositing. Moving away and back counts as not moved.
- **Live preview through history**: there's no separate preview path. Each frame of a drag runs a
  `MoveLayerCommand` with the drag's merge key, and history merges it into the previous one. The
  viewport, ants, status bar and thumbnails update as for any edit, and the drag is one undo
  step. One command per animation frame keeps compositing to the display rate.
- **The outline rides in the move**: moving a floating selection replaces the selection in the
  same command, so it's the same undo step. It's always the lifted selection translated by the
  total offset, so pushing it off the canvas and back brings it back whole.
- **Session state, like the active layer**: `editor.floating` is one `FloatingSelection` rather
  than separate layer and source IDs. It also carries the selection and position as lifted, and
  the snapshot that makes an unmoved commit exact. It isn't in the document and is never saved,
  but lift and commit report it, so undo and redo restore it.
- **Commit instead of keeping in step**: anything that would change the source or the selection
  commits the floating selection first, as one more undo step, so undo always gets back to it.
  That's simpler than updating a floating layer to follow its source.
- **The floating layer looks like its source**: it copies the source's opacity, visibility and
  blend mode. Committing treats both as plain opaque Normal layers and merges into the source's
  own pixels, so those properties still apply once, through the source.
- **Saving and exporting commit after the file picker**, inside the store's `data()` callback, so
  cancelling the picker leaves the selection floating. Save records the save point after the
  commit, so the document is clean afterwards.
- **Replacing the document drops the floating selection** instead of committing it, since the old
  document is going away. A lift is an unsaved change, so New, Open and Close ask first.
- **Cancelling undoes**: Escape undoes the drag's own steps, each only while it's still the latest
  history state, so it never undoes anything else.
- **No auto-select**: the cursor is the move arrow everywhere, and the tool always moves the
  active layer, like Photoshop with Auto-Select off.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 368 tests across 31 files (73 new)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:5173
```

Unit tests cover:

- **`PixelSnapshot`**: exact bytes restored inside the rect and nothing outside, an independent
  copy, clipping, an empty rect, and a buffer of the wrong size.
- **`Selection.translate`**: coverage and bounds moved, clipping at the canvas edges, empty when
  moved entirely off, no-ops and fractional offsets.
- **`MoveLayerCommand`**: apply and revert, dirty rects with no `layerPixels`, positions off the
  canvas, merging within a gesture but not across layers or gestures, selection moves, and null
  when nothing changes.
- **Nudges**: offsets, the one-second window, resets, unique keys, and a run of nudges as one
  undo step.
- **Lift pixel math** against hand-computed values for full, zero and partial (128) coverage,
  including what stays in the source. A copy leaves the source untouched, and undo restores the
  exact bytes.
- **Commit**:
  - the identity on the source for every alpha × coverage when unmoved, also after moving away
    and back at 50 % opacity;
  - lift, move and commit against a hand-computed buffer;
  - undo and redo, dirty rects and `layerPixels`, growing the source, and copies.
- **`Editor`**: the floating state through lift, commit, undo, redo, a change of active layer and
  a document replace.
- **Move tool**: 15 pointer and key sequences through the `ToolManager`, with `FakeViewport` and a
  fake frame clock. They cover:
  - one undo step per drag, one move per frame, Shift, clicks, hidden layers and cancelling;
  - nudges, lifting and moving with the outline, off the canvas and back, and Alt copies;
  - committing on a tool switch and before a marquee click deselects;
  - letting go when the document changes underneath.
- **Commit points**: layer actions and `commitFloatingFrom`, the Select menu, Save (the file has no
  floating layer) and Export.

In the browser, with a photo open:

- [ ] V selects the Move tool. The options bar explains the modifiers, and the cursor is the move
      arrow.
- [ ] With no selection, drag the layer partly and wholly off the canvas and back. One Ctrl/Cmd+Z
      undoes the drag, Shift keeps to one axis, and Esc mid-drag cancels.
- [ ] Arrow keys nudge by 1 px and Shift+arrow by 10. Quick presses undo in one step; presses
      more than a second apart undo separately.
- [ ] Marquee a region and drag inside it. A "Floating selection" row appears above the layer, in
      italics and active, and the ants move with the pixels. Nudge it with the arrow keys.
- [ ] Ctrl/Cmd+D commits it. Undo steps back through the commit, the moves and the lift, to the
      photo as it was.
- [ ] Alt-drag a selection: a copy moves, and the original stays put.
- [ ] With an elliptical selection, the lifted pixels and the hole left behind have soft edges.
      Lifting and committing without a move leaves the photo unchanged.
- [ ] While a selection floats, Duplicate, Delete and Move Layer Up/Down are disabled, and its row
      can't be renamed, dragged, hidden or faded. Ctrl/Cmd+Enter and Merge Down commit it.
- [ ] Each of these commits it first: a new marquee, Select All, Inverse, switching tools,
      clicking another layer, Alt+[ or Alt+], New Layer, Flatten Image, hiding or fading the
      source layer, and Export.
- [ ] Save while a selection floats. Cancelling the file picker leaves it floating; saving commits
      it. The reopened file has no floating layer and matches what was committed.

These checks were run in Microsoft Edge (WebView2) at 125 % display scaling, with scripted
pointer and key events and by hand, on a 1920 × 1200 JPEG photo. Results:

- Moving the layer and undoing gave back identical pixels (same hash).
- Marquee, drag, a run of nudges and Ctrl+D, then undoing back through the commit, the nudges,
  the move and the lift, left the photo layer byte-identical. The ants followed throughout.
- An Alt-drag left the source unchanged, and the copy matched the selected pixels exactly.
- With an elliptical selection, the lifted and remaining alpha matched the coverage formula on all
  812 partly selected pixels.
- Saving mid-float: the cancelled picker left it floating. The saved file held one layer, and
  reopening it gave the committed pixels with no byte differences.
- Hiding the source while floating made two steps, "Commit Floating Selection" then "Hide Layer",
  and two undos floated the selection again. Dragging the source's opacity slider committed once
  and made one "Change Layer Opacity" step.
- Shift, Esc, the floating row's restrictions, the Layer menu's disabled items, off-canvas moves
  and a translucent source behaved as described. Ctrl+Enter, Select All, Export, a tool switch, a
  new marquee, a row click, Alt+] and Flatten each committed first. Nudges 1.3 s apart made two
  undo steps.
- Moving a whole 1920 × 1200 layer took about 35 ms a frame, and a floating selection in it about
  18 ms. A 6400 × 4000 version of the photo moved at about 3 frames a second.

## Known limitations

- **Speed on very large layers**: each frame of a drag recomposites the old and new bounds of what
  moves, on the CPU. That keeps up at photo sizes, but a whole 6400 × 4000 layer moves at about 3
  frames a second. A faster compositor (an opaque fast path, or a GPU one behind the existing
  seam) would fix that without changing the tool.
- **Outline retracing**: a moving floating selection is a new selection each frame, so its ants
  are traced again (about 7 ms for a 2000 × 1500 selection). Offsetting the cached path would be
  cheaper, except where the canvas clips it.
- **Soft edges while floating**: until it's committed or moved, a partly selected edge pixel shows
  the floating layer over what's left beneath, which lets a little more through (a quarter, for
  an opaque pixel at half coverage). Committing in place restores it exactly.
- **Memory**: each lift keeps the rect it cut, and each commit the rect it changed, or both whole
  source buffers when the source grew, up to the 200-step cap. This belongs with the "history
  storage" open decision; tiled snapshots would go behind `PixelSnapshot`.
- **Off the canvas**: selections are canvas-sized, so the part of a floating selection off the
  canvas has no ants, and one moved wholly off has no selection at all. Select → Deselect and
  Inverse are then disabled; Ctrl/Cmd+Enter still commits, and moving it back restores the
  outline.
- **No message when nothing can move**: dragging a hidden layer, or a selection that misses the
  active layer, does nothing. Photoshop explains why.
- **Cancelled drags stay redoable**: Escape cancels by undoing, so the drag's steps stay on the
  redo stack until the next edit.
- **Changing the source's look commits**: hiding or fading the source layer commits the floating
  selection rather than updating the floating layer to match.

## Deliberately out of scope

- **Auto-Select and transform controls**: the Move tool always acts on the active layer.
- **Transforming a floating selection** (scale, rotate, flip): step 12.
- **Moving just the selection outline**, as dragging inside a selection with a marquee does in
  Photoshop.
- **Cut, copy and paste** through the clipboard. Floating selections are the groundwork for paste.
- **Snapping, guides, alignment, and moving several layers at once.**
- **Sub-pixel moves**: offsets stay whole pixels, so moving never resamples.
- **Tiled snapshots and a faster compositor**: follow-ups, noted above.
- **Saving a floating selection**: Save commits it, so the `.pixelsoup` format is unchanged.
