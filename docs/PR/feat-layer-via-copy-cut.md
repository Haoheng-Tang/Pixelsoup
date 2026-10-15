# feat: Layer via Copy and Cut, the clipboard and a canvas context menu

## Summary

Photoshop's ways of turning a selection into a layer, a clipboard that works with other apps,
and a right-click menu on the canvas. Everything here is built on the existing commands,
selection masks, floating selections and layer actions.

- **Layer via Copy (Ctrl/Cmd+J) and Layer via Cut (Ctrl/Cmd+Shift+J)**: the selected pixels of
  the active layer go into a new "Layer N" directly above it, the size of the selection's
  bounds, which becomes active. Soft edges stay soft: each pixel is weighted by its coverage,
  exactly as lifting a floating selection weights it. The cut also takes them out of the
  source, which keeps old × (1 − coverage). Both deselect, as Photoshop does. Ctrl/Cmd+J
  without a selection still duplicates the layer.
- **Edit → Cut, Copy, Copy Merged and Paste** (Ctrl/Cmd+X, C, Shift+C, V): Cut and Copy take
  the active layer's selected pixels, Copy Merged what the visible layers show. Paste adds them
  as a new "Layer N" above the active layer: back where they came from on a canvas of the same
  size, otherwise centred in view.
- **The system clipboard**: copies are also written there as an exact PNG, so they paste into
  other apps, and Ctrl/Cmd+V pastes an image copied in another app as a new layer, through the
  browser's paste event (no permission prompt). Where the browser can't, Pixelsoup's own
  clipboard still works.
- **A context menu on the canvas**: right-clicking the document offers Deselect, Select
  Inverse, Layer via Copy and Layer via Cut with a selection, and Duplicate Layer… and Delete
  Layer without one. Duplicate Layer… asks for the copy's name; Delete Layer asks first. The
  browser's menu never shows over the viewport, and the right button never starts a tool's
  gesture.

Every new edit is one undo step and undoes to the exact bytes. Copying isn't an undo step,
and the clipboard is session state, like the colours. The `.pixelsoup` format is unchanged,
and there are no new dependencies.

## What's included

Commits are meant to be reviewed one at a time:

1. **Share the selected-pixel math between lifting and copying** (`selected-pixels.ts`;
   refactor, no behaviour change for lifting):
   - `splitSelectedPixels(source, selection, target, cut)` is `LiftSelectionCommand`'s pixel
     loop, moved out and generalised to any placed buffer. With coverage c, a pixel with alpha
     a puts round(a × c / 255) into `target`, its colour unchanged, and with `cut` the source
     keeps the rest, a pixel left with no alpha becoming transparent black. There are no .5
     ties, so both parts are correctly rounded.
   - `copySelectedPixels` copies into a new buffer covering the selection's bounds, and
     `copySelection(doc, source)` takes one layer's pixels (hidden or not) or the composite of
     the visible layers (`compositeLayers`, for Copy Merged).
2. **Layer via Copy and Layer via Cut** (`copy-commands.ts`, `layer-commands.ts`,
   `layer-actions.ts`, `use-layer-shortcuts.ts`, `LayerMenu.tsx`):
   - `LayerViaCopyCommand` and `LayerViaCutCommand` share one base: the new layer takes the
     source's opacity and blend mode, so the pixels look as they did, and the selection is
     cleared. The cut saves the area it cuts in a `PixelSnapshot`; undo restores the source
     and the selection, and redo cuts again from the same pixels. The cut lists the source in
     `layerPixels`, so its thumbnail updates.
   - `layerViaCopyCommand` and `layerViaCutCommand` are null without a selection, for a
     missing or hidden layer (as in Photoshop), or when the selection's bounds miss the layer
     (`selectionReachesLayer`).
   - `PasteCommand` adds given pixels as a new layer at a stack index and clears the
     selection, one step "Paste"; `pasteCommand` builds it above a layer as "Layer N".
   - `DuplicateLayerCommand` takes an optional name (trimmed, never blank), so the Duplicate
     Layer dialog is one undo step rather than a duplicate and a rename. `nextLayerName` and
     `duplicateName` are exported for the new commands and the dialog.
   - `runLayerAction` gains `layer-via-copy` and `layer-via-cut`. A floating selection is
     committed first, and they then take the merged pixels from its source.
   - `layerActionFor(e, hasSelection)`: Ctrl/Cmd+J is Layer via Copy with a selection and
     Duplicate Layer without one; Ctrl/Cmd+Shift+J is Layer via Cut. The Layer menu has both
     new items, and the J badge shows on whichever of Duplicate Layer and Layer via Copy the key
     would run.
3. **Cut, Copy, Copy Merged and Paste** (`clipboard/pixel-clipboard.ts`,
   `use-clipboard-shortcuts.ts`, `EditMenu.tsx`, `fill-commands.ts`):
   - `PixelClipboard` holds the copied pixels, where they came from and the size of their
     canvas. `canRun` enables the menu items: Cut and Copy need a selection that reaches the
     visible active layer, Copy Merged any selection, and Paste something copied.
   - Cut is Copy followed by `clearCommand`, which now takes an undo label, so it's one step
     "Cut" and the source keeps exactly what Clear would leave. Every copy commits a floating
     selection first.
   - `pastePosition` puts pixels back where they came from on a canvas of the same size when
     they fit, else centres them in the part of the canvas in view (`visibleArea()`, new on
     the viewport), kept on the canvas, or centres them on the canvas if they're larger.
   - Cut, Copy and Copy Merged call `preventDefault`. Ctrl/Cmd+V doesn't, so the browser
     fires its paste event, whose image `PixelClipboard.pasteData` decodes and pastes. If no
     paste event follows (Safari fires one only in editable elements), the key pastes
     Pixelsoup's own clipboard. Edit → Paste always pastes Pixelsoup's own.
   - **Which copy wins**: from a copy until the window loses focus, no other app can have
     changed the system clipboard, so Pixelsoup's copy is pasted. After that, an image from
     the paste event that matches Pixelsoup's copy (`sameImage`, allowing for the browser's
     premultiplied re-encoding) pastes Pixelsoup's exact pixels at their original place, and
     any other image pastes as it is, centred in view.
   - The Edit menu reads Undo, Redo | Cut, Copy, Copy Merged, Paste | Fill…, Clear. The
     shortcuts are ignored in text fields, while a dialog is open or a file operation runs,
     and for keys the active tool used; held keys don't repeat.
4. **Write copies to the system clipboard as PNG** (`clipboard/system-clipboard.ts`):
   `writeImageToSystemClipboard` calls `navigator.clipboard.write` straight away, within the
   key press or click (Safari requires that), with a `ClipboardItem` whose PNG, from the exact
   encoder in `io/png.ts`, is encoded on a later task. It resolves to false where the browser
   has no `ClipboardItem` or refuses, and never rejects, so failures are silent.
5. **Type the transparent pixel in the clipboard tests as `Rgba`**: a fix-up for a test type
   error in commit 3, which fails `tsc -b` on its own. Squash the two if every commit on
   `main` must build.
6. **A canvas context menu with Duplicate Layer and Delete Layer dialogs**:
   - `menu-logic.ts` holds the menus' plain logic: `MenuEntry` (moved from `MenuButton`),
     `ContextMenuItem` (an entry that carries its `run`), `menuKeyAction` (the WAI-ARIA menu
     keys), `clampMenuPosition` and `closesContextMenu`.
   - `MenuList` draws a menu's items, separators and shortcut badges and handles its keys:
     the arrows wrap round, Home and End jump, Enter and Space choose, Escape and Tab close,
     each marked as used so tools and shortcuts leave them alone. `MenuButton` now uses it
     (refactor; the menu bar behaves as before).
   - `ContextMenu` opens at the pointer, kept inside the window, and closes on Escape, Tab, a
     press or wheel outside it, a scroll, a resize or the window losing focus. Choosing an
     item closes it and then runs the item. A press it should swallow (`swallowsPress`) only
     closes it.
   - `canvasMenuSections` (`canvas-menu.ts`) builds the items, running the same
     `runSelectCommand` and `runLayerAction` as the menu bar, all disabled while a dialog is
     open or a file operation runs. `Tool.contextMenu?()` lets a tool add sections, shown
     first; none does yet. `CanvasMenu` rebuilds them as things change, closes on a zoom, a
     replaced or resized document or a dialog opening, and swallows presses on the viewport.
   - **The right button**: the viewport's `contextmenu` handler always calls
     `preventDefault`, and asks for the menu only over the document (`isOnCanvas`), outside a
     gesture or pan and while no dialog is open. A right press, or a Control-click on a Mac
     (`isContextClick`), never reaches the tool, and `ToolManager` passes on only primary
     presses and double-clicks (`ToolPointerEvent.button`) as well. Focus goes back to the
     canvas when the menu closes (`viewport.focus()`).
   - **Duplicate Layer…** (`DuplicateLayerDialog`): "Duplicate: <name>" and an "As:" field
     starting as "<name> copy", selected. OK or Enter duplicates under that name, directly
     above, and activates the copy; a blank name disables OK.
   - **Delete Layer** (`ConfirmDeleteLayerDialog`): an alert dialog, "Delete the layer
     “<name>”?", with Cancel focused so Enter is safe, and Delete. Disabled for the only layer.
   - `AppController` opens both (`openDuplicateLayer`, `openDeleteLayer`) and runs them through
     `runLayerAction`, and `showError` is now public so the clipboard can report an image it
     couldn't decode.
   - **`Dialog` restores focus on close**: it closes in a layout effect, while the dialog is
     still in the document, so the browser gives the focus back to what had it (the canvas,
     say) rather than to the page. This applies to every dialog.
7. **Docs**:
   - `docs/layers.md`: the new commands in the table, their dirty rects and `layerPixels`, a
     "Layer via Copy and Layer via Cut" section, what commits a floating selection, the J and
     Shift+J shortcuts and badge, "Duplicate and Delete from the canvas", and "Asking first"
     as an open decision.
   - `docs/tools.md`: the right-button rule, `Tool.contextMenu`, a "Context menu" section, the
     Edit menu's new order, and a "Clipboard" section with the browser matrix and open
     decisions.
   - README: the features, the Layer and Edit shortcut tables and a paragraph on pasting.
     CLAUDE.md lists the new folders and files and stays under 200 lines.

## Design notes

- **One pixel routine for every copy**: lifting, Layer via Copy and Cut, and Cut and Copy all
  go through `splitSelectedPixels`, so a soft edge gives the same pixels whichever way it's
  taken, and what a cut takes plus what it leaves is the original (a test checks every
  coverage against every alpha, and against Clear).
- **Deselecting**: Layer via Copy and Cut clear the selection, as in Photoshop, and so does
  Paste; undo brings it back. Cut keeps it, so the hole is still selected.
- **The new layer's look**: Layer via Copy and Cut copy the source's opacity and blend mode,
  so nothing seems to change. Cut and Copy take a layer's own pixels, not its opacity, and a
  paste is a plain layer at 100 %; Copy Merged takes what's shown, opacity included.
- **Hidden layers**: Cut, Copy and Layer via Copy and Cut refuse a hidden active layer, as
  Photoshop does, rather than copying pixels you can't see.
- **Ctrl/Cmd+J's badge moves**: with a selection it shows on Layer via Copy, without one on
  Duplicate Layer, so the menu always shows what the key does. Duplicate Layer keeps its item.
- **Pasting from other apps without asking**: reading the system clipboard with
  `navigator.clipboard.read` prompts for permission in most browsers, while the paste event
  that Ctrl/Cmd+V fires carries the image freely. So the key isn't suppressed, and the menu's
  Paste, which has no paste event, uses Pixelsoup's own clipboard.
- **Only the context menu asks**: the Layer menu's Duplicate Layer and Delete Layer and the
  panel's buttons still act straight away. They could share the dialogs later if that feels
  inconsistent.
- **The right button is stopped twice**: the viewport never forwards it, and `ToolManager`
  ignores anything but primary presses, so a tool can't see one even through another route.
- **Items carry their actions**: `ContextMenuItem.run` keeps the menu generic, so a tool's
  Fill… or Free Transform can be added through `Tool.contextMenu` without touching the menu.
- **Allocating IDs**: the command factories take a fresh layer ID when they're built, so
  `canRunLayerAction` checks `selectionReachesLayer` rather than building a command.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 898 tests across 74 files (95 new; 7 new files)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover:

- **Selected pixels**: weighting by coverage with and without `cut`, in canvas space; a
  selection that misses the source; the cut taking exactly what Clear clears and leaving
  exactly the rest, at every coverage level; copies covering the selection's bounds; one
  layer, hidden or not, and the composite for Copy Merged.
- **Commands**: Layer via Copy and Cut against hand-worked bytes at full, zero and partial
  coverage; the name, the index directly above and the size of the selection's bounds;
  deselecting; exact undo and redo of the source and selection; snapshotting only the area
  cut; the null cases. `PasteCommand`'s layer, index, dirty area and cleared selection.
  `DuplicateLayerCommand`'s name, trimmed and never blank; `nextLayerName`; Clear's label.
- **Layer actions and shortcuts**: Ctrl/Cmd+J branching on the selection and Shift+J;
  duplicating under a name in one step; Layer via Copy and Cut making the new layer active
  and deselecting, refusing a hidden layer or a selection that misses, and committing a
  floating selection first.
- **The clipboard**: copying weighted by coverage, transparency where the layer doesn't reach;
  Cut as one "Cut" step equal to Copy then Clear; Copy Merged from the composite; the enabled
  states; committing a floating selection; a copy and paste round trip, pixel for pixel, as a
  new active layer above the active one; `pastePosition` on the same canvas, another canvas,
  without a view and for pixels larger than the canvas; a paste event's PNG decoded and
  centred in view; Pixelsoup's copy winning while newest and recognised after a round trip
  (`sameImage`); an event with no image; an image that can't be decoded; a refused system
  write; `imageFileOf`; `clipboardShortcutFor` with Ctrl and Cmd, and not with Alt or AltGr.
- **The context menu**: its items and enabled states with and without a selection, for the
  only layer, a hidden layer, a selection that misses, while blocked and while a selection
  floats; tool sections first, empty ones dropped; each item doing exactly what the menu bar
  does, as one undo step with the same label, floating selection included; `isOnCanvas` at
  the edges and over the void; `isContextClick` on a Mac and elsewhere; `menuKeyAction`,
  `clampMenuPosition` and `closesContextMenu`.
- **The dialogs**, through `AppController`: Duplicate Layer offering "<name> copy",
  duplicating under the name given in one step, refusing a blank name and cancelling; Delete
  Layer naming the layer, Cancel, Delete and undo, and not opening for the only layer or over
  another dialog.
- **The right button**, through the `ToolManager` with `FakeViewport`: a right press and drag
  starts no gesture with the Rectangular Marquee, Polygonal Lasso, Lasso, Brush or Move tool,
  adds no vertex to a polygon in progress, and doesn't double-click.

These checks were run with a script driving headless Microsoft Edge through the DevTools
protocol, with real pointer and key events, on a public-domain 1464 × 2022 photo of the Statue
of Liberty against a cloudy sky. It ran against `npm run preview` (the same `dist/` Cloudflare
serves), not the Cloudflare preview, which needs the branch pushed. Layers were compared pixel
by pixel with the source × coverage worked out separately. Everything passed, with no console
errors:

- **The menu**: a right-click over the void opened nothing and changed nothing. With no
  selection it offered Duplicate Layer… and Delete Layer (disabled for the only layer), the
  first item focused; Escape closed it with the focus back on the canvas, and the marquee
  hadn't seen the click. A right-drag with the marquee selected nothing.
- **Layer via Copy**: a Magic Wand click on the sky (1464 × 1936 bounds, 10,069 partly covered
  pixels), then the menu: Deselect, Select Inverse | Layer via Copy, Layer via Cut, with their
  shortcuts. Two ArrowDowns and Enter made "Layer 1" above the photo, active and deselected,
  equal to source × coverage at the selection's bounds, with the source unchanged and the wand
  not clicked. One undo removed it and brought the selection back. Ctrl+J gave the identical
  layer.
- **Layer via Cut**: Ctrl+Shift+J made the same layer and left a hole: fully selected sky
  pixels transparent in the source, the rest exact. Undo restored the source exactly, and the
  menu's Layer via Cut matched the shortcut.
- **Closing**: with the menu open, a click on the canvas closed it without a Magic Wand step,
  and the wheel closed it.
- **Copy and Paste**: Ctrl+C wrote a 1464 × 1936 8-bit RGBA PNG to the clipboard API (captured
  by a hook in the page) and changed nothing. Ctrl+V pasted "Layer 1" at the original
  position, deselected, equal to Layer via Copy. Ctrl+X cleared the selected pixels as one
  "Cut" step, and undo restored them exactly.
- **Pasting from another app**: a paste event carrying a 40 × 30 PNG made a 40 × 30 layer with
  its exact pixels, centred in the visible part of the canvas.
- **Duplicate Layer…**: the dialog read "Duplicate: Layer 1" with "Layer 1 copy" selected; a
  blank name disabled OK and Enter did nothing; "Sky" and Enter made "Sky" directly above,
  active, as one "Duplicate Layer" step, with the focus back on the canvas. Escape cancelled.
- **Delete Layer**: an alert dialog "Delete the layer “Sky”?" with Cancel focused; Enter on
  Cancel and Escape kept the layer, and Tab then Enter on Delete deleted it as one step.
- **Undo** through everything restored the opened photo, with one layer and no selection.
- **The menu bar** after the `MenuButton` refactor: the arrows, End, wrapping, and Escape
  returning the focus to the menu's button.

In the browser, with a photo open (on the Cloudflare preview once pushed):

- [ ] Wand a region, then Ctrl/Cmd+J: a new layer with soft edges, the selection gone; undo.
- [ ] Ctrl/Cmd+Shift+J: the same layer, and a hole in the source when the new layer is hidden;
      undo.
- [ ] Ctrl/Cmd+C in Pixelsoup, then paste into another app (Paint, Word, Slack): the copied
      pixels, with transparency where the app supports it.
- [ ] Copy an image in another app (a screenshot, an image in a browser tab), then Ctrl/Cmd+V
      in Pixelsoup: a new layer centred in view.
- [ ] Ctrl/Cmd+X, Ctrl/Cmd+Shift+C and Edit → Paste.
- [ ] Right-click the canvas with and without a selection, and over the void; Duplicate
      Layer… and Delete Layer.
- [ ] Undo through all of it back to the original.

## Known limitations

- **Other apps get a re-encoded image**: Chromium browsers decode what's written to the
  system clipboard and re-encode it through premultiplied alpha, so translucent colours pasted
  into other apps may be slightly off. Pixelsoup's own pastes stay exact.
- **Safari doesn't paste images from other apps** with Ctrl/Cmd+V: it fires paste events only
  in editable elements, so the key pastes Pixelsoup's own clipboard. Copies do reach the
  system clipboard from Safari 13.1, and from Firefox 127.
- **Which copy is newest**: if the system clipboard couldn't be written, and the window lost
  focus and came back without a copy elsewhere, Ctrl/Cmd+V pastes the older image still on
  the system clipboard. Edit → Paste still pastes Pixelsoup's.
- **The PNG is encoded on the main thread**, as saving is: about 150 ms at 1920 × 1080, on a
  task after the copy itself.
- **Browsers may keep some shortcuts**: Ctrl/Cmd+Shift+C for their element inspector and
  Ctrl/Cmd+Shift+J for their developer tools. The Edit and Layer menus always work.
- **Only the context menu asks** before duplicating or deleting (see the design notes).
- **No tool adds context menu items yet**, and the menu has no submenus.
- **Not tried here**: the Cloudflare preview, the real OS clipboard with another app, a Mac's
  Control-click and Cmd shortcuts, Firefox and Safari, and pen or touch (a long press may open
  the menu where the browser fires `contextmenu` for it).

## Deliberately out of scope

- **Paste in Place, Paste Into and Paste Special.**
- **A context menu on the layer panel's rows**, and routing the Layer menu's Duplicate and
  Delete through the dialogs.
- **Tool items in the context menu** (Fill…, Free Transform): the extension point is there.
- **Other clipboard formats** than PNG, and reading the system clipboard from the menu.
- **Encoding the clipboard PNG in a worker.**
