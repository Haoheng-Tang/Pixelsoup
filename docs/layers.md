# Layers

How layers are managed: the active layer, the layer commands, and the Layer panel, menu and
shortcuts. The code lives in `src/core/editor.ts` (active layer), `src/core/commands`
(`layer-commands.ts`, `merge-commands.ts`), `src/ui/layer-actions.ts` and `src/ui/panels`.

## The active layer

- `editor.activeLayerId` names the layer that layer commands, and later the move tool and
  brushes, act on. It's **session state**, as in Photoshop: not part of `ImageDocument`, never
  saved and never a history step. Changing it doesn't make the document unsaved, and undo
  doesn't bring back the layer that was active before.
- While the document has layers it always names one of them; it's null only when there are
  none. `setActiveLayer(id)` changes it and throws for an ID that isn't in the document.
- `Editor` fixes it up after every command, undo and redo. If the active layer went away it
  moves to the layer that was below it, else the one above (the bottom one now), else the top.
  So deleting selects the layer below, and merging or flattening selects the result.
  `replaceDocument` activates the top layer.
- Subscribers hear about every change through `subscribe`, flagged `activeLayerChanged`.
- New layers, copies and imported images become active: the UI calls `setActiveLayer` after
  executing their command.

## Layer IDs

`createLayerId(doc)` hands out `layer-1`, `layer-2`, … per document, and numbering continues
after load (see the file format). `nextLayerNumber` is an ID allocator, so it changes outside
commands: `newLayerCommand` and `duplicateLayerCommand` take an ID even if their command never
runs. Code that only asks whether an action is possible (`canRunLayerAction`) mustn't call them.

## Commands

All are undoable and report dirty rects as usual. Each factory returns null when its command
would do nothing, like the selection helpers.

| Factory                                 | Effect                                                        | Null when                                   |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `newLayerCommand(doc, aboveId)`         | transparent canvas-sized "Layer N" above `aboveId` (or top)   | never                                       |
| `duplicateLayerCommand(doc, id)`        | copies the layer, pixels included, as "… copy" directly above | the layer is missing                        |
| `removeLayerCommand(doc, id)`           | deletes the layer                                             | missing, or the only layer                  |
| `reorderLayerCommand(doc, id, toIndex)` | moves it to stack index `toIndex` (0 = bottom)                | missing, already there, or out of range     |
| `renameLayerCommand(doc, id, name)`     | renames it                                                    | missing, blank name, or unchanged           |
| `mergeDownCommand(doc, id)`             | merges it into the layer below                                | no layer below, or either layer hidden      |
| `flattenCommand(doc)`                   | flattens the visible layers into one                          | nothing visible, or already one plain layer |

`newLayerCommand` returns an `AddLayerCommand`; the others return the matching class
(`DuplicateLayerCommand`, `RemoveLayerCommand`, …). A document always keeps at least one layer.

- **Dirty rects**: adding, removing, duplicating or moving a layer dirties its canvas area.
  Renaming dirties nothing. Merge and flatten dirty the result's canvas area.
- **`layerPixels`**: merge and flatten list the result layer in `DocumentChange.layerPixels`,
  both ways, because the layer with that ID has different pixels. **Every command that changes
  a layer's pixels must list it there** (layer space; `rect: null` for the whole layer), or its
  thumbnail won't update.

### Merge down

- The result is the compositor's output for the two layers alone (`compositeLayers`, the same
  blend math), so they look as they did: each layer's opacity is baked into the pixels and the
  result is visible at opacity 1.
- It keeps the lower layer's ID, name and blend mode, and covers the union of both layers'
  bounds, or the canvas if the union would exceed 8192 pixels on a side.
- Merging is refused while either layer is hidden, as in Photoshop, rather than quietly
  dropping the hidden one.

### Flatten

All visible layers become one canvas-sized layer at 0, 0 that keeps the ID and name of the
bottom visible layer. Hidden layers are discarded and transparent areas stay transparent.

## Layer panel

- Rows list the top of the stack first. Clicking a row or its name makes that layer active,
  and the active row is highlighted (`aria-current`). The eye button and the opacity slider
  don't change the active layer.
- **Reorder** by dragging a row (after 4 px of travel). A line shows where it will land, Esc
  cancels, and each drop is one undo step. It uses pointer events, not the HTML5 drag API, so
  mouse, pen and touch behave alike. Rows set `touch-action: none`, so on touch screens a drag
  on a row reorders rather than scrolls the list.
- **Rename** with a double-click on the name, or F2 while it has focus. Enter commits, Esc
  cancels, and clicking elsewhere commits a valid name. Blank names are refused and names are
  trimmed.
- **Buttons** along the bottom: New layer, Duplicate layer, Delete layer and Merge down. They're
  disabled when they would do nothing, or while a dialog or file operation is running.
- `canRunLayerAction` and `runLayerAction` (`src/ui/layer-actions.ts`) back the buttons, the
  Layer menu and the shortcuts, so all three enable and behave alike.

### Thumbnails

- Each row shows its layer's own pixels over a checkerboard: the layer's bounds, not its place
  on the canvas. They're fitted into 64 × 40 CSS pixels and drawn at device resolution.
  Shrinking averages up to 4 × 4 samples per thumbnail pixel, weighted by alpha. Enlarging
  repeats pixels.
- `LayerThumbnails` draws them outside React, like the viewport. A thumbnail is redrawn only
  when its layer's pixels change (an entry in `layerPixels`, or a new buffer), the document is
  replaced, or the pixel ratio changes. That happens at most once per animation frame.

## Layer menu and shortcuts

| Keys                   | Action                                       |
| ---------------------- | -------------------------------------------- |
| Ctrl/Cmd+Shift+N       | new layer above the active one               |
| Ctrl/Cmd+J             | duplicate the active layer                   |
| Ctrl/Cmd+E             | merge down                                   |
| Ctrl/Cmd+[, Ctrl/Cmd+] | move the active layer down, up               |
| Alt+[, Alt+]           | select the layer below, above (no menu item) |

The Layer menu also has Delete Layer and Flatten Image, which have no shortcuts.

- Shortcuts call `preventDefault`, so the browser's own action doesn't run (downloads,
  search, back and forward). They're ignored while typing in a text field. Only the move and
  select shortcuts repeat while held.
- Brackets match by key position as well as character, because Option+[ types a quotation
  mark on a Mac. Ctrl+Alt (AltGr) never matches.
- Browsers may keep Ctrl/Cmd+Shift+N for themselves (a new private window in Chrome, Edge and
  Safari), so in a normal tab use the menu or the New layer button.

## Open decisions

- **Opacity** is stored as a float in 0–1. The UI slider uses whole percents.
- **Undo and the active layer**: undo doesn't restore which layer was active.
- **Merged pixels are 8-bit**: merging onto an opaque layer is exact. A merge of translucent
  layers above other layers can shift the composite by one level per channel where they
  overlap, because the merged pair is rounded before it's composited.
- **Flatten naming** keeps the bottom visible layer's name; Photoshop names the result
  "Background".
- **Memory**: merge and flatten keep the replaced layers whole in history.
- **Thumbnails** show the layer's own bounds; Photoshop's default shows the whole canvas.
- **Long lists**: dragging doesn't auto-scroll the layer list.
