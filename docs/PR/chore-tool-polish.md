# chore: Crop box on activation, toolbar tool groups and the `.soup` extension

## Summary

Three small improvements to tools and files. No core pixel logic changes.

- **The Crop tool puts up a box straight away**: the selection's bounds, or else the whole
  canvas, with its handles, size readout and (unless it's the whole canvas) the dimming
  outside it. This initial box is _unarmed_: its handles adjust it, but a drag inside it draws a
  new box. Once it has been adjusted, drawn afresh or fitted to a ratio it's _armed_, and a
  drag inside moves it, as before. Enter on the untouched whole-canvas box does nothing (no
  undo step), and Escape or ✗ puts back the initial box rather than leaving the tool boxless.
- **One toolbar button per tool group**: tools that share a shortcut key (the marquees on M,
  the lassos on L) are one button showing the group's last-used tool, its icon, name and key.
  A corner triangle marks it. A click activates that tool; a right-click, a 400 ms press, a
  click on the triangle or Arrow Down opens a flyout listing the group, and choosing a tool
  activates it. The keys and Shift+key work as before, and the button follows them. Grouping
  is generic: a new tool given an existing key joins that button with no toolbar changes.
- **Documents are `.soup` files**: Save and Save As suggest `Untitled-1.soup`, and the file
  pickers and the download fallback use `.soup`. The old `pixelsoup` extension is gone entirely:
  the open picker no longer offers it and nothing recognises it by name. The format itself is
  unchanged (same zip container, `formatVersion` 1, MIME type `application/x-pixelsoup`).

No new dependencies.

## What's included

Commits are meant to be reviewed one at a time:

1. **Crop tool: put up a box as soon as it's active** (`crop-tool.ts`, `crop-geometry.ts`,
   `CropOptionsPanel.tsx`, `tool.ts`, `selection-overlay.ts`):
   - The box's state is `initial`, `fitted` or `adjusted`; `armed` is true once it isn't
     `initial`. In the initial box a press inside is treated as one outside, so it draws.
   - `canCommit` is false only for the untouched box equal to the canvas, so Enter, a
     double-click and ✓ do nothing then. A selection-bounds initial box can crop at once.
   - `canReset` (✗, and Escape) is true while the box is armed; `resetBox()` puts back the
     initial box. While unarmed, the tool leaves Escape alone.
   - Choosing a ratio for the initial box fits the largest box of that shape inside it,
     centred (`fitBox`, new in `crop-geometry.ts`), and arms it unless the result is the initial
     box itself. An adjusted box is reshaped about its centre, as before.
   - After a crop, a canvas resize or a replaced document, the box starts again as the whole
     canvas. Switching tools discards it.
   - `CropOverlay.shade` is false while the box is the whole canvas, so nothing is dimmed.
2. **Toolbar: one button per tool group, with a flyout** (`tool-manager.ts`,
   `tool-groups.ts`, `ToolPicker.tsx`, `MenuList.tsx`, `menu-logic.ts`, `styles.css`):
   - `ToolManager.groups` groups the tools by shortcut key, in toolbar order, and
     `lastUsed(group)` reads the last-used tool it already tracked for Shift+key cycling. That's
     the only record of it; the toolbar keeps no state of its own.
   - `toolButtonView`, `toolGroupLabel` and `toolFlyoutSections` (`tool-groups.ts`, no DOM)
     work out what each button and flyout shows, so they're unit-tested.
   - `ToolButton` has `aria-haspopup="menu"` and `aria-expanded` on grouped buttons. The
     flyout is the existing `ContextMenu`, below the button, its items `menuitemradio` with the
     last-used one ticked. A choice, Escape or a press outside closes it with the focus back on
     the button; a press on the button while it's open only closes it. Single-tool buttons are
     plain buttons, as before.
   - `MenuList` items can carry an icon and be radio items (`icon`, `radio`).
3. **Save documents as `.soup`** (`file-types.ts`, `document-session.ts`,
   `memory-file-store.ts`): `PIXELSOUP_EXTENSION` is `.soup`, which names saves and downloads
   and fills the pickers' accept lists. This commit still opened files with the old `pixelsoup`
   extension; commit 5 removes that.
4. **Docs**:
   - `docs/tools.md`: a Toolbar bullet in "ToolManager and input routing", the rewritten "Crop
     tool" section (the initial box, armed and unarmed, ratios, committing), the crop shading
     note in Drawing, and "Adding a tool" on joining a group.
   - `docs/file-format.md`: retitled "The `.soup` file format", with an Extension section.
   - README: the features list (toolbar groups, the crop box, `.soup` files) and the Crop
     shortcuts table. CLAUDE.md stays at 199 lines.
5. **Drop the old `pixelsoup` extension**: the legacy extension constant, the open picker's
   extra entry, the name check and their tests are gone, and the docs, README, CLAUDE.md and
   earlier PR write-ups say `.soup` throughout. A case-insensitive `git grep` for the old
   extension, dot included, comes back empty.

## Design notes

- **Why an unarmed box**: the box that appears on activation shouldn't get in the way of
  simply drawing one, so until it's touched a drag inside it draws, as dragging anywhere did
  before. Once you've adjusted a box, you probably want to move it rather than lose it.
- **Escape doesn't remove the box any more**: the tool always shows one, so Escape and ✗
  return to where the tool started. With nothing to undo they do nothing, and Escape is left
  to whatever else might want it.
- **The toolbar reads the `ToolManager`**: the button, the keys and the flyout all go through
  `ToolManager.activate`, so the last-used tool can't disagree between them.
- **Recognising documents by content**: Open still treats any file starting with the zip
  signature as a document, whatever its name (a renamed `art.zip` opens), as it did before.
  So an old file with the `pixelsoup` extension, chosen through "All files", still opens; it
  just isn't offered or recognised by its extension.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 910 tests across 75 files (tool-groups.test.ts is new)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover:

- **Crop**: the whole-canvas initial box, which Enter and Escape leave alone; drawing from
  inside the untouched box; handles arming it; the grid and dimming; fitting a ratio inside
  the initial box until it's adjusted, then reshaping; trimming only once the whole-canvas box
  is adjusted; Escape cancelling a drag, then putting back the initial box; the selection's
  bounds as the initial box; no undo step for a box that changes nothing; starting again
  after a resize or a replaced document; discarding the box on a tool switch; telling
  subscribers when ✓ and ✗ change. `fitBox` on its own.
- **Tool groups**: one button per key, grouping the marquees and the lassos; the button
  following the key, Shift+key and other tools; the flyout's items, icons, keys and tick;
  choosing from it. `ToolManager.groups` order and `lastUsed`.
- **Files**: saves suggest and write `.soup`, and both open pickers accept `.soup` only;
  opening and saving back in place; a renamed document still recognised by its signature.

These checks were run with a script driving headless Microsoft Edge (1400 × 900 at 125 %)
through the DevTools protocol, with real pointer and key events, against a local dev server,
not the Cloudflare preview, which needs the branch pushed. Everything passed:

- **Crop** (27 checks): C put up a whole-canvas box with handles and its size in the status
  bar, nothing dimmed and ✓ and ✗ disabled. Enter and a double-click cropped nothing and
  added no step; Escape left the box. Dragging the right edge resized it and armed it (grid
  and dimming during the drag, ✓ and ✗ enabled after). Escape and ✗ each put back the
  whole-canvas box with no step. A drag inside the unarmed box drew a new one; a drag inside
  the drawn box moved it. 1:1 fitted a centred 1080 × 1080 square, and 16:9 gave back the
  unarmed initial box. With a marquee selection, C started at its bounds (✓ enabled) and
  Enter cropped to it as one "Crop" step; the box then covered the new canvas, and undo
  restored the canvas and a whole-canvas box. Switching to Move discarded the box.
- **Tool groups** (31 checks): nine buttons, M and L marked and the rest plain. Shift+M, L and
  Shift+L changed the buttons' icons, names and tooltips. A right-click on L opened "Lasso
  tools" below the button with icons, keys and the current tool ticked, activating nothing;
  choosing Lasso activated it and returned the focus. A 400 ms press opened the M flyout (not
  at 250 ms) without activating anything on release. The triangle toggled the flyout, and a
  press on the button closed it. Escape, an outside press, and Arrow Down then Enter all
  behaved. The Move button opened no flyout.
- **`.soup` files**: Save suggested `Untitled-1.soup` with a save picker accepting `.soup`
  only, and wrote a zip with both layers. Reopened, it showed its layers, and Save wrote it in
  place without a picker. Both open picker entries listed `.soup` and not the old extension.
  Without the File System Access API, each Save downloaded `Untitled-1.soup`, and the file
  input accepted `application/x-pixelsoup,.soup,image/png,…`.

In the browser (on the Cloudflare preview once pushed):

- [ ] Press C: a box over the whole canvas, undimmed. Drag a handle, then drag inside: it
      moves. Esc: back to the whole canvas.
- [ ] With the untouched box, drag inside: a new box is drawn.
- [ ] Make a selection, press C: the box starts at the selection. Enter crops; undo.
- [ ] Shift+M and Shift+L: the M and L buttons change icons. Right-click, long-press and the
      corner triangle open their flyouts; choose a tool from each.
- [ ] Save a document: `Untitled-1.soup`. Reopen it and save again in place.

## Known limitations

- **The initial box doesn't follow the selection**: changing the selection while the Crop
  tool is active leaves the box where it was; reselect the tool to start from the new bounds.
- **Old files with the `pixelsoup` extension** aren't offered by the open picker. Rename them
  to `.soup`, or
  pick them through "All files", where their zip signature still opens them.
- **Not tried here**: the Cloudflare preview, a Mac, Firefox and Safari, and long presses
  with touch or a pen.

## Deliberately out of scope

- **New tool groups** (healing and clone, type tools): the grouping is ready for them.
- **Flyouts for single-tool buttons**, and showing every tool of a group in the toolbar.
- **Changing the MIME type** `application/x-pixelsoup` or the format version.
