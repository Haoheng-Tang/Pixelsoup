# feat: layer management and a Windows launcher

## Summary

This PR adds two new features:

1. **Layer management**: Pixelsoup can now add, duplicate, delete, reorder, rename, merge and
   flatten layers, and it gains the active layer that the move tool and brushes will act on.
2. **A Windows launcher**: double-clicking `start-pixelsoup.cmd` starts the dev server and opens
   Pixelsoup in its own Microsoft Edge window, with no need to type `npm run dev`.

They're independent: the launcher changes no app code, and the layer work doesn't rely on it.

### 1. Layer management

This is a small step between steps 5 and 6 of the build order.

- **Active layer**: `Editor.activeLayerId` is session state, as in Photoshop: never part of the
  document, never saved, never an undo step. It always names an existing layer and moves to a
  neighbour when its layer goes away.
- **Layer commands in core**, all undoable with dirty rects:
  - remove, duplicate, reorder, rename, merge down and flatten;
  - a canvas-sized new layer above the active one.

  Factories return null when a command would do nothing, and the last layer can't be removed.

- **Merge Down runs the compositor itself**, so the merged layer looks exactly like the pair did,
  opacity and offsets included.
- **Layer panel**:
  - click a row to make it active (it's highlighted);
  - New layer, Duplicate, Delete and Merge down buttons;
  - drag-and-drop reordering with an insertion line;
  - inline renaming and thumbnails.
- **Layer menu and shortcuts**: Ctrl/Cmd+Shift+N, Ctrl/Cmd+J, Ctrl/Cmd+E, Ctrl/Cmd+[ and ],
  Alt+[ and ]. The menu also has Delete Layer and Flatten Image.

The `.pixelsoup` format is unchanged. Layer order, names and pixels already round-trip, and the
active layer isn't saved.

### 2. Windows launcher

A convenience for starting Pixelsoup on Windows without a terminal.

- **One double-click**: `start-pixelsoup.cmd` in the repo root installs the dependencies the first
  time, starts the dev server in a console window titled "Pixelsoup", and opens the app as soon as
  the server answers.
- **Its own window**: Pixelsoup opens in a Microsoft Edge app window, without tabs or an address
  bar, or in the default browser if Edge is missing.
- **Already running**: if Pixelsoup already answers at http://localhost:5173, the launcher only
  opens another window instead of starting a second server.
- **Quitting**: closing the console window stops the server.
- **Shortcut**: the README shows how to make a desktop or taskbar shortcut that can be pinned.

## What's included

Commits are meant to be reviewed one at a time. Commits 1–7 add layer management, and commit 8 adds
the launcher.

### Layer management

1. **Layer stack commands** (core):
   - `RemoveLayerCommand`, `DuplicateLayerCommand` (pixels and properties, named "… copy",
     directly above), `ReorderLayerCommand` (to a stack index) and `RenameLayerCommand`.
   - `AddLayerCommand` takes an optional stack index. `newLayerCommand(doc, aboveId)` makes a
     transparent canvas-sized "Layer N" directly above a layer, or on top.
   - The factories return null when the command would change nothing or isn't allowed:
     - a missing layer;
     - removing the only layer;
     - a move to where the layer already is;
     - a blank or unchanged name.
   - Helpers: `findLayerIndex` and `getLayerIndex` (`document.ts`), `duplicateLayer` (`layer.ts`).
   - A `.pixelsoup` round-trip test with duplicated, renamed and reordered layers.
2. **Merge down and flatten** (core):
   - `MergeDownCommand`:
     - The result is `compositeLayers([lower, upper], area)`, which runs `CpuCompositor` on just
       that pair.
     - Each layer's opacity is baked in, and the result is visible at 100 %.
     - It keeps the lower layer's ID, name and blend mode.
     - It covers both layers' bounds, or the canvas if their union would exceed 8192 px on a side.
   - `FlattenCommand`: the visible layers become one canvas-sized layer at 0, 0 that keeps the ID
     and name of the bottom visible layer. Hidden layers are discarded; transparency is kept.
   - `mergeDownCommand` is null for the bottom layer, or when either layer is hidden.
     `flattenCommand` is null when nothing is visible, or when the document is already one plain
     canvas-sized layer.
   - `DocumentChange.layerPixels` lists the layers whose own pixels changed (layer space; a null
     rect means the whole layer). Merge and flatten list the result on apply and on revert.
3. **Active layer in `Editor`** (core):
   - `activeLayerId`, `activeLayer` and `setActiveLayer(id)`, which throws for an ID that isn't in
     the document. Changes are announced with `activeLayerChanged`.
   - After every command, undo and redo, if the active layer went away, it moves to the layer that
     was below it, else the one above, else the top. `replaceDocument` activates the top layer.
4. **Layer panel: active row, buttons, drag reorder and rename**:
   - Clicking a row or its name activates the layer (`is-active`, `aria-current`). The eye button
     and the opacity slider don't.
   - Buttons under the list:
     - New layer, Duplicate layer, Delete layer and Merge down;
     - disabled when they'd do nothing, or while a dialog or file operation is running;
     - tooltips show the shortcuts.
   - `src/ui/layer-actions.ts` (`canRunLayerAction`, `runLayerAction`) backs the buttons, the menu
     and the shortcuts, so they always agree. New layers and copies become active.
   - Drag a row to reorder it:
     - pointer events, not the HTML5 drag API;
     - a 4 px threshold and an insertion line;
     - Esc cancels, and each drop is one undo step;
     - the geometry lives in `layer-drag.ts`.
   - Rename inline with a double-click on the name or F2:
     - Enter commits and Esc cancels;
     - blank names are refused (`aria-invalid`), and names are trimmed;
     - clicking away keeps a valid name.
   - File → Import Image as Layer now puts the image directly above the active layer (it used to
     go on top) and makes it active.
5. **Layer menu and shortcuts**:
   - The Layer menu has three groups: New Layer, Duplicate Layer and Delete Layer; Move Layer Up
     and Move Layer Down; Merge Down and Flatten Image.
   - `use-layer-shortcuts.ts`: Ctrl/Cmd+Shift+N, Ctrl/Cmd+J, Ctrl/Cmd+E, Ctrl/Cmd+[ and ], and
     Alt+[ and ] to select the layer below or above.
6. **Thumbnails**:
   - `thumbnail-pixels.ts` (pure):
     - fits the layer into 64 × 40 CSS px;
     - shrinks by averaging up to 4 × 4 alpha-weighted samples per thumbnail pixel, and enlarges
       by repeating pixels (nearest neighbour);
     - draws over the viewport's checkerboard colours.
   - `layer-thumbnails.ts`: `LayerThumbnails` draws into each row's canvas outside React, at
     device resolution, at most once per animation frame. Its browser hooks (frames, pixel ratio,
     drawing) are injectable, so the scheduling is unit-tested.
   - The sidebar is 20 px wider (300 px) to make room.
7. **Docs**:
   - New `docs/layers.md`, imported from `CLAUDE.md`. It covers the active-layer rule, the
     commands and when they're null, merge and flatten, the `layerPixels` contract, the panel and
     thumbnails, the menu and shortcuts, and open decisions.
   - `CLAUDE.md` states the active-layer rule and updates the folder layout and the build order.
     The layer-ID and opacity notes moved into `docs/layers.md`, and it stays at 199 lines.
   - The README lists the layer features and has a layer shortcuts table.

### Windows launcher

8. **Windows launcher** (`start-pixelsoup.cmd`; no app code changes):
   - If Pixelsoup already answers at http://localhost:5173, it opens another window and exits.
   - Otherwise it checks that Node.js is installed, runs `npm ci` when `node_modules` is missing,
     and runs the dev server in its console window, titled "Pixelsoup".
   - A background job in the same console waits for the server to answer (up to 30 checks, about
     a minute), then opens a Microsoft Edge app window, or the default browser without Edge.
   - If the server can't start, the console shows the error and waits for a key.
   - `.gitattributes` checks `*.cmd` files out with CRLF line endings.
   - The README's "Getting started" describes the launcher and a pinnable shortcut. In `CLAUDE.md`,
     the `npm run dev` row notes that the launcher runs the same server; the file stays at 199
     lines.

## Design notes

### Layer management

- **The active layer is session state** because picking a layer isn't an edit. It shouldn't mark
  the document unsaved, fill the undo stack or be written to files. Undo doesn't restore the
  previously active layer; it only moves off a layer that undo removed.
- **One blend implementation**:
  - `compositeLayers` puts the pair into a temporary document, moved into the merge area and
    sharing their pixel buffers, and runs `CpuCompositor` on it.
  - A test checks that the merged pixels equal the compositor's output for those two layers alone.
  - Future blend modes will merge correctly with no extra work.
- **Keeping the lower layer's ID** means anything that refers to the lower layer, such as the
  active layer or its thumbnail, still finds it after the merge. When the upper layer was active,
  the fix-up rule moves the active layer down onto the result.
- **Hidden pairs are refused**: merging with a hidden layer would either drop its pixels or
  reveal them, so Merge Down is disabled instead.
- **Flatten keeps the bottom visible layer's name.** Photoshop names the result "Background".
- **Factories that allocate IDs**: `newLayerCommand` and `duplicateLayerCommand` take an ID from
  the document whenever they're called. So `canRunLayerAction` decides from the stack alone and
  never calls them, and enabling buttons and menu items never uses up IDs.
- **`layerPixels` is a contract**: every command that changes a layer's pixels must list that
  layer there, or its thumbnail won't update. That includes the brush, move tool and adjustments
  to come. Adding, removing, reordering and restyling layers aren't listed, so they don't redraw
  thumbnails.
- **Thumbnails redraw only when needed**. A canvas counts as stale when any of these changed:
  - a per-layer version, bumped by `layerPixels`;
  - the layer's buffer (a new object);
  - a generation counter, bumped when the document is replaced;
  - the pixel ratio.

  Changes are coalesced into one animation frame.

- **Thumbnails show the layer's own bounds** (aspect-correct), not its place on the canvas, so
  small or offset layers stay legible. Photoshop's default shows the whole canvas instead.
- **Dragging**:
  - The row captures the pointer only once the drag starts, so clicks and double-clicks on the
    name still work.
  - A drop is ignored if the document was replaced mid-drag.
  - The list is keyed per document, so row state such as an open rename never carries over to
    another document.
- **Shortcuts**:
  - Brackets match by key position as well as character, because Option+[ types a quotation mark
    on a Mac. Ctrl+Alt (AltGr) never matches.
  - Matching shortcuts always call `preventDefault`, so the browser's own action (downloads,
    search, back and forward) doesn't run. They're ignored in text fields.
  - Only move and select repeat while held.
  - Alt+[ and Alt+] have no menu items, as menu shortcuts always include Ctrl/Cmd.

### Windows launcher

- **Same server as `npm run dev`**: the `dev` script is plain `vite`, so the launcher runs
  `node node_modules\vite\bin\vite.js --strictPort` directly. npm's command shims reset the
  console title, and the "Pixelsoup" title is what tells you which window keeps the server
  running.
- **`--strictPort`**: otherwise Vite moves to another port when 5173 is taken, and the launcher
  would open the wrong address.
- **Recognising a running Pixelsoup**: the script fetches http://localhost:5173 with Windows' own
  `curl.exe` and looks for `<title>Pixelsoup</title>`, so another server on that port isn't
  mistaken for it. The script's header says the port and title must stay in step with the dev
  server and `index.html`, and `CLAUDE.md` notes that the launcher runs the dev server.
- **Waiting for the server**: the server runs in the foreground of the console, so a background
  job in the same console polls the page and opens the window once it answers. A connection to a
  closed localhost port takes over 2 s to fail on Windows, so each poll has a 1 s connect timeout.
- **Edge app mode** (`msedge --app=…`) gives Pixelsoup a window of its own. Edge comes with
  Windows; if it isn't registered, the default browser opens instead.
- **Pinnable shortcuts**: Windows doesn't offer to pin a shortcut to a `.cmd` file, but it pins one
  whose target is `cmd.exe /c "…\start-pixelsoup.cmd"`, which is the form the README shows.
- **CRLF line endings**: the repo checks text out with LF, but cmd.exe can misread labels in batch
  files with LF endings, so `.gitattributes` makes `*.cmd` an exception.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 295 tests across 26 files (74 new)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:5173
```

### Layer management

Unit tests cover:

- **Every command**: apply, undo and redo, dirty rects, null when it would do nothing, last-layer
  protection. Copies get their own pixels and IDs.
- **Merge Down pixel math**:
  - hand-computed values for opaque, translucent and offset layers, with opacity on either layer;
  - equality with the compositor's output for the pair;
  - parts off the canvas are kept, and the canvas is used past 8192 px;
  - the document composite stays the same to within rounding.
- **Flatten**: the visible layers are composited and hidden ones discarded; undo restores them all.
- **Active-layer fix-up** after delete, merge, flatten, reorder, undo and document replace. It's
  never an undo step or an unsaved change.
- **`.pixelsoup` round trip** with duplicated, renamed and reordered layers; numbering continues
  after loading.
- **UI logic, without a DOM**:
  - layer actions and when they're enabled;
  - drop-slot geometry;
  - shortcut mapping;
  - thumbnail fitting and downsampling;
  - thumbnail redraw scheduling, with a fake frame clock;
  - importing above the active layer.

In the browser:

- [ ] Open a photo (JPEG) and import a PNG with transparency as a layer. It lands centred,
      directly above the active layer, and becomes active.
- [ ] New layer adds "Layer N" above the active layer. Try the button, the Layer menu, and
      Ctrl/Cmd+Shift+N where the browser allows it.
- [ ] Ctrl/Cmd+J duplicates the active layer as "… copy". Both new layers and copies become active.
- [ ] Clicking a row highlights it. The eye button and opacity slider don't change the active
      layer, and Alt+[ and Alt+] walk down and up the stack.
- [ ] Drag a row: a line shows where it will land, and the drop is one undo step. Esc cancels, and
      dropping it where it was does nothing. Ctrl/Cmd+[ and ] move the active layer.
- [ ] Rename with a double-click or F2. Enter keeps the name, Esc cancels, a blank name is refused,
      and layer shortcuts don't fire while you type.
- [ ] Merge Down:
  - [ ] Give the imported layer 50–60 % opacity and merge it onto the photo. The canvas looks the
        same before and after, and the result is named after the photo layer, at 100 %.
  - [ ] Merge Down is disabled on the bottom layer, and when either layer is hidden.
- [ ] Flatten Image leaves one layer, discards hidden layers, and doesn't change the canvas.
- [ ] Delete makes the layer below active, and is disabled for the last layer.
- [ ] Thumbnails update after import, merge, flatten, undo and redo. They aren't redrawn for
      opacity, visibility, reordering or renaming.
- [ ] Undoing all the way back returns to the opened file and clears the ● marker; redo replays.
- [ ] Save, reload the page and open the file. Names, order, opacity, visibility and pixels match,
      and new layers get IDs that don't collide.
- [ ] The layer buttons, menu and shortcuts are inactive while a dialog is open.

These checks were run in Microsoft Edge at 125 % display scaling, with scripted pointer and key
events and by hand. Results, using a 640 × 480 JPEG and a centred 360 × 240 translucent PNG:

- Merging the PNG at 60 % opacity into the photo left the exported image identical, pixel for
  pixel.
- Merging two translucent layers above the photo changed 15,430 of 307,200 pixels by one level
  (see "Known limitations").
- Flattening left the export identical. Eleven undos returned to the opened file, and redo rebuilt
  the flattened image exactly.
- Saving through the download fallback, then reloading and reopening, gave the same layer
  metadata and a byte-identical export.

### Windows launcher

The launcher has no automated tests. On Windows:

- [ ] Double-click `start-pixelsoup.cmd`. A console titled "Pixelsoup" starts the server, and
      Pixelsoup opens in its own Edge window once the server is ready.
- [ ] Double-click it again. Another window opens within a few seconds, the second console closes
      by itself, and no second server starts.
- [ ] Close the console. The server stops.
- [ ] With another program listening on port 5173, the launcher shows Vite's "Port 5173 is already
      in use" error, waits for a key and opens no window.
- [ ] Make a shortcut whose target is `cmd.exe /c "<path to>\start-pixelsoup.cmd"` and pin it to
      the taskbar.

Results on Windows 11 24H2 with Edge and Node 24.13.0, launching through a desktop shortcut of
that form. The console opened in Windows Terminal, the system default.

- The app window opened about 7 s after launch; Vite itself was ready in about 2 s.
- A second launch opened another window after about 2 s. Its console closed by itself, and one
  server kept running.
- Closing the console stopped Vite and esbuild and freed the port.
- With a stand-in server on port 5173, the launcher showed Vite's port error and opened no window.
- The first-run branch was exercised in a scratch folder: it ran `npm ci`, then went on to start
  Vite.

## Known limitations

### Layer management

- **8-bit merges**: merging onto an opaque layer is exact. Merging translucent layers above other
  layers can shift the composite by one level per channel where they overlap. That's because the
  merged pair is rounded to 8 bits before it's composited.
- **Memory**: merge and flatten keep the replaced layers whole in history, up to the 200-step cap.
  This belongs with the existing "history storage" open decision.
- **Long lists**: dragging a row doesn't auto-scroll the layer list.
- **Touch**: rows set `touch-action: none` so that a touch drag reorders. As a result, a layer list
  taller than the panel can't be scrolled by dragging on its rows.
- **Browser-reserved shortcuts**: Chrome, Edge and Safari may keep Ctrl/Cmd+Shift+N for a new
  private window. Layer → New Layer and the panel's button always work.

### Windows launcher

- **Windows only**: on macOS and Linux, run `npm run dev` as before.
- **Dependencies are installed only when `node_modules` is missing**, so run `npm install` after
  pulling changes to `package.json`.
- **Port 5173 taken by another program**: the console shows Vite's error and waits for a key.
  After that, the background job can keep the console open a while longer, typically under a
  minute.
- **Two quick double-clicks** can start two servers at once; the second fails with the same port
  error.

## Deliberately out of scope

### Layer management

- **Move tool and brushes** (steps 6 and 7). They'll act on the active layer.
- **Layer via Copy**: in Photoshop, Ctrl/Cmd+J with a selection copies only the selected pixels.
  Here it always duplicates the whole layer.
- **Working with several layers at once**: multi-select (Shift- or Ctrl-click), groups, locks and
  linking.
- **Other layer commands**: Merge Visible, Delete Hidden Layers and a layer properties dialog.
- **Blend modes beyond Normal, and layer masks** (step 12).
- **Restoring the active layer on undo**, and thumbnail options (size, whole-canvas view).
- **File format changes**: none were needed, and the active layer isn't saved.

### Windows launcher

- **Launchers for macOS and Linux.**
- **An installable app**: the launcher runs the dev server. An installable PWA is still an open
  decision in `CLAUDE.md`.
- **Updating dependencies on every start**: running `npm install` each time would slow the start
  and can rewrite `package-lock.json`.
- **An app icon**: none was added to the repo.
