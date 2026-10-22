# Pixelsoup

An open-source, layered raster image editor that runs in your browser, like a lightweight
Photoshop.

## Live

[Open Pixelsoup](https://pixelsoup.lumenon.workers.dev/) on Cloudflare, or its
[mirror on GitHub Pages](https://haohengt.com/Pixelsoup/).

> Early days: Pixelsoup can create, open, save, import and export documents, manage their
> layers (add, duplicate, reorder, rename, merge, flatten, show, hide and fade them), select
> with marquees, lassos and a magic wand, move layers and selected pixels, paint and erase with
> soft or hard brushes, fill and clear selections or fill with a paint bucket, crop, resize,
> rotate and flip images, and transform layers or selected pixels with Free Transform (move,
> scale, turn, skew, distort and perspective). Adjustments and other tools are on the roadmap.

## Features so far

- New documents up to 8192×8192 pixels with a white or transparent background
- Native layered `.soup` files (a zip of `document.json` plus one PNG per layer; see
  [docs/file-format.md](docs/file-format.md)) that keep every layer's pixels exactly
- Open PNG, JPEG and WebP images as new documents, or import them as a centred new layer
- Drop a `.soup` file or an image anywhere on the page to open it, as File → Open does
- Export the visible layers, flattened, as PNG, JPEG (with a quality setting) or WebP
- Unsaved-changes marker in the toolbar and window title, with a prompt before anything is
  discarded
- File shortcuts: Ctrl/Cmd+N new, Ctrl/Cmd+O open, Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as,
  Ctrl/Cmd+Shift+E export
- Layered documents: per-layer RGBA pixels, position, opacity, visibility and blend mode
  (Normal)
- Viewport with a transparency checkerboard, zoom to cursor (mouse wheel) and pan
  (Space+drag or middle-mouse drag)
- Layer panel with thumbnails, visibility toggles, live opacity sliders, drag-and-drop
  reordering and inline renaming; the active layer is highlighted
- Layer menu and panel buttons: new layer, duplicate, delete, move up and down, merge down and
  flatten image. Merging bakes in each layer's opacity, so the image looks the same afterwards
- Layer via Copy and Layer via Cut: the selected pixels, soft edges included, become a new
  layer, copied or cut out of the active one
- Toolbar with one button per tool group: the marquees share one, as do the lassos, showing
  the one last used. Right-click it, hold it down or click its corner triangle to choose
  another from a flyout
- Rectangular and elliptical marquee tools (the ellipse has anti-aliased edges) in New, Add,
  Subtract and Intersect modes, picked in the tool-options bar or with modifier keys
- Lasso and Polygonal Lasso with anti-aliased edges, in the same modes. An outline that
  crosses itself selects every loop, and as in Photoshop, Alt switches the Lasso to straight
  sides
- Magic Wand that selects similar colours, within a tolerance, either connected to the pixel
  clicked or across the whole image, with optional anti-aliasing, sampling the active layer or
  all visible layers
- Select menu: Select All, Deselect and Inverse
- Marching ants that stay a hairline wide and track the canvas exactly at every zoom level.
  They stay smooth on selections with thousands of specks: zoomed out, the outline is traced
  at screen resolution, loops too small to march hold still instead of blinking, and with
  WebGL 2 the ants are drawn on the GPU
- View menu: Extras hides or shows the marching ants, keeping the selection
- Move tool: drag or nudge the active layer anywhere, even off the canvas. With a selection it
  lifts the selected pixels (soft edges included) into a floating selection that moves with
  its outline, or copies them with Alt; committing drops them back into their layer, exactly
  as they were if they didn't move
- Brush and Eraser with size (1–500 px), hardness and opacity, and optional pen pressure for
  size, opacity or both. Opacity works as in Photoshop: a stroke never paints more than its
  opacity where it crosses itself, while the next stroke builds on it. Fast strokes leave no
  gaps, painting respects the selection's soft edges, and painting past a layer's edges grows it
- Foreground and background colours as two toolbar swatches, each with a picker (a
  saturation/brightness square, a hue strip, and hex and R, G, B fields)
- Eyedropper that picks a colour from the image, or from the active layer alone
- Paint Bucket that fills similar colours with the foreground colour, at any opacity, blending
  into anti-aliased edges instead of leaving a fringe
- Edit menu: Undo, Redo, Cut, Copy, Copy Merged and Paste, Fill… (the foreground or
  background colour, black, white, 50% grey or any colour, at any opacity, optionally
  preserving transparency) and Clear, with Photoshop's shortcuts. All respect the
  selection's soft edges. Copies go on the system clipboard as PNG too, and images copied in
  other apps paste as new layers. Then Free Transform, and Transform: Scale, Rotate, Skew,
  Distort, Perspective, and exact flips and quarter turns of the active layer
- Free Transform: move, scale, turn, skew and distort the active layer, or the selected
  pixels, or put them in perspective, with handles on the canvas (Photoshop's Ctrl/Cmd keys
  included) or exact values in the options bar (position, size in pixels or percent, angle,
  skew, interpolation). The preview keeps up with the pointer even on large images, distorted
  ones included, and applying is one undo step with smooth, anti-aliased edges
- Right-click menu on the canvas: Deselect, Select Inverse, Layer via Copy and Layer via Cut
  with a selection; Duplicate Layer… (name the copy) and Delete Layer (with a confirmation)
  without one; and Free Transform. During a transform it offers its modes (Scale, Rotate,
  Skew, Distort, Perspective), flips, turns, Reset to Original, Apply and Cancel
- Crop tool: a box appears straight away, around the selection or the whole canvas. Resize it
  with eight handles, draw a new one, or move it once you've adjusted it, freely or at a fixed
  ratio (the original's, 1:1, 4:3, 3:2, 16:9 or custom), with a rule-of-thirds grid while
  adjusting. A box past the canvas enlarges it with transparent space. Cropped-away pixels stay
  on their layers unless "Delete cropped pixels" is on
- Image menu: Crop to Selection; Image Size in pixels or percent, resampled with nearest
  neighbour or bilinear; Canvas Size with a 3×3 anchor, relative sizes and a button that swaps
  width and height; and lossless 90° and 180° rotations and horizontal and vertical flips.
  Resampling never darkens edges next to transparency
- Status bar with the pointer's document position, the selection, crop or transform size, and
  brief messages such as a new brush size
- Undo/redo for every edit, selection changes included (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y)

### Selection shortcuts

| Keys                                | Action                                                |
| ----------------------------------- | ----------------------------------------------------- |
| M                                   | marquee tool (Shift+M switches rectangle and ellipse) |
| Ctrl/Cmd+A, Ctrl/Cmd+D              | select all, deselect                                  |
| Ctrl/Cmd+Shift+I                    | inverse                                               |
| Ctrl/Cmd+H                          | hide or show the marching ants (View → Extras)        |
| Shift, Alt, Shift+Alt at drag start | add to, subtract from, intersect with the selection   |
| Shift during a drag                 | constrain to a square or circle                       |
| Alt during a drag                   | draw from the centre                                  |
| Click without dragging              | deselect                                              |
| Esc during a drag                   | cancel                                                |

Shift or Alt used to pick the mode at the start of a drag constrain or centre the shape only
after being released and pressed again. With no selection, they constrain straight away.
Selections aren't saved in `.soup` files, and changing one doesn't count as an unsaved
change. Some browsers keep Ctrl/Cmd+D (bookmark) or Ctrl/Cmd+Shift+I (developer tools) for
themselves, and Mac browsers usually take Cmd+H to hide themselves; the Select and View menus
always work.

### Lasso and Magic Wand shortcuts

| Keys                                           | Action                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| L                                              | lasso tool (Shift+L switches freehand and polygonal) |
| W                                              | magic wand                                           |
| Shift, Alt, Shift+Alt at the first press       | add to, subtract from, intersect with the selection  |
| Drag (Lasso)                                   | draw freehand; releasing closes the outline          |
| Click (Polygonal Lasso)                        | add a corner                                         |
| Shift (Polygonal Lasso)                        | keep the next side to 45° steps                      |
| Click the first corner, double-click, or Enter | close the outline                                    |
| Backspace or Delete                            | take back the last corner                            |
| Release a Lasso drag with Alt held             | carry on with straight sides, until Alt is released  |
| Esc                                            | cancel the outline; with none, deselect              |
| Click (Magic Wand)                             | select the colours like the one clicked              |

The Magic Wand's options bar sets the tolerance (how far each of red, green, blue and alpha may
be from the pixel clicked, 0–255), whether only pixels connected to it count (Contiguous),
Anti-alias, and Sample all layers (otherwise it looks at the active layer only).

### Layer shortcuts

| Keys                       | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Ctrl/Cmd+Shift+N           | new layer above the active one                              |
| Ctrl/Cmd+J                 | Layer via Copy with a selection, else duplicate the layer   |
| Ctrl/Cmd+Shift+J           | Layer via Cut: cut the selected pixels out into a new layer |
| Ctrl/Cmd+E                 | merge down                                                  |
| Ctrl/Cmd+[, Ctrl/Cmd+]     | move the active layer down, up                              |
| Alt+[, Alt+]               | select the layer below, above                               |
| Double-click a name, or F2 | rename (Enter keeps it, Esc cancels)                        |
| Drag a layer               | reorder (Esc cancels)                                       |
| Right-click the canvas     | the context menu                                            |

Selecting a layer isn't an edit: it isn't saved and isn't an undo step. Merge Down needs both
layers visible. Flatten Image discards hidden layers. Layer via Copy and Cut put the new layer
directly above the active one and deselect. Browsers may keep Ctrl/Cmd+Shift+N for a new
private window, and Ctrl/Cmd+Shift+J for their developer tools; the Layer menu always works.

### Move tool shortcuts

| Keys                | Action                                                            |
| ------------------- | ----------------------------------------------------------------- |
| V                   | move tool                                                         |
| Drag                | move the active layer, or lift and move the selected pixels       |
| Alt+drag            | copy the selected pixels and move the copy                        |
| Shift during a drag | keep to one axis                                                  |
| Arrow keys          | nudge by 1 pixel (Shift: 10); quick runs of nudges undo at once   |
| Ctrl/Cmd+Enter      | commit the floating selection (Layer → Commit Floating Selection) |
| Esc during a drag   | cancel, undoing the lift too                                      |

A floating selection stays on its own layer until it's committed. That happens by itself when
you deselect or change the selection, pick another layer or tool, add a layer, merge, flatten,
crop, change the image or canvas size, rotate or flip the canvas, save or export, so a saved
file never contains one. Each lift, move and commit is an undo step, and undoing a commit
floats the pixels again.

### Free Transform shortcuts

| Keys                             | Action                                                 |
| -------------------------------- | ------------------------------------------------------ |
| Ctrl/Cmd+Alt+T                   | Free Transform (Edit → Free Transform)                 |
| Drag a corner or an edge         | scale both ways, or one way                            |
| Shift on a corner                | keep the proportions                                   |
| Alt during a drag                | scale about the centre                                 |
| Drag just outside a corner       | rotate (Shift: in 15° steps)                           |
| Drag inside the box              | move (Shift: along one axis)                           |
| Ctrl/Cmd+drag a corner           | distort: move that corner on its own                   |
| Ctrl/Cmd+drag an edge            | skew (with Alt: the opposite edge the other way)       |
| Ctrl/Cmd+Alt+Shift+drag a corner | perspective: it and its neighbour move apart or closer |
| Arrow keys                       | nudge by 1 pixel (Shift: 10)                           |
| Enter, or double-click inside    | apply                                                  |
| Esc                              | cancel (during a drag: put the box back where it was)  |

Free Transform acts on the active layer, or lifts the selected pixels first. Anything else
that changes the document (another tool, a menu command, saving) applies it first, and Undo
cancels it. Browsers keep Ctrl/Cmd+T for a new tab, so Pixelsoup uses Ctrl/Cmd+Alt+T, as
Photopea does. On Ubuntu, which opens a terminal on Ctrl+Alt+T, use the Edit menu. Edit →
Transform → Scale, Rotate, Skew, Distort and Perspective (also in the right-click menu during
a transform) make a plain drag on a handle do just that, and its flips and quarter turns turn
the active layer exactly, or the transform in progress. The box always stays convex.

### Painting shortcuts

| Keys                        | Action                                         |
| --------------------------- | ---------------------------------------------- |
| B, E, G, I                  | brush, eraser, paint bucket, eyedropper        |
| [, ]                        | smaller, larger brush                          |
| Shift+[, Shift+]            | softer, harder brush                           |
| Shift-click                 | straight line from where the last stroke ended |
| Alt with the Brush, Eraser  | pick the foreground colour while held          |
| Alt-click (Eyedropper)      | pick the background colour                     |
| X                           | swap the foreground and background colours     |
| D                           | reset the colours to black and white           |
| Esc during a stroke or pick | cancel it                                      |

Each stroke is one undo step, clipped to the selection. The Eraser erases to transparency on
every layer. Pen pressure only applies to pens; mouse strokes use the full size and opacity.
The colours aren't saved, and changing them isn't an undo step. Each Paint Bucket click is one
undo step too; the bucket has the Magic Wand's options, plus an opacity.

### Edit shortcuts

| Keys (Mac)                           | Action                                                  |
| ------------------------------------ | ------------------------------------------------------- |
| Alt+Backspace (Option+Delete)        | fill the selection (or the canvas) with the foreground  |
| Ctrl+Backspace (Cmd+Delete)          | fill it with the background colour                      |
| Shift added to either                | the same, preserving transparency                       |
| Shift+Backspace (Shift+Delete)       | Edit → Fill…                                            |
| Delete or Backspace (Delete)         | Edit → Clear: clear the selected pixels to transparency |
| Ctrl/Cmd+X, Ctrl/Cmd+C               | cut, copy the selected pixels of the active layer       |
| Ctrl/Cmd+Shift+C                     | copy merged: the selected pixels of all visible layers  |
| Ctrl/Cmd+V                           | paste as a new layer                                    |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | undo, redo                                              |

Fills and clears are one undo step each, act on the active layer and respect the selection's
soft edges. Preserving transparency recolours only the pixels that aren't transparent and
keeps their transparency, to recolour a brush stroke for example. The Fill dialog remembers
its settings until the page is reloaded.

A paste goes back where it was copied from, or else into the middle of the view, as a new
layer above the active one. Copies also go on the system clipboard as PNG where the browser
allows it, and Ctrl/Cmd+V pastes an image copied in another app. Details and browser support:
[docs/tools.md](docs/tools.md#clipboard).

### Crop shortcuts

| Keys                          | Action                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| C                             | crop tool, with a box around the selection, or the whole canvas |
| Drag outside the box          | draw a new box                                                  |
| Drag inside the box           | draw a new box at first; move the box once it's been adjusted   |
| Drag a handle                 | resize                                                          |
| Shift during a drag           | keep the box square, or its shape (with the Free ratio)         |
| Alt during a drag             | draw or resize from the centre                                  |
| Enter, or double-click inside | crop (not while the box is still the untouched whole canvas)    |
| Esc                           | put back the starting box (during a drag: the box as it was)    |

Each crop is one undo step. The Image menu holds the rest: Crop to Selection, Image Size…,
Canvas Size…, and the rotations and flips (exact: four quarter turns or two flips give back the
same pixels). They have no shortcuts. More on how they work: [docs/transform.md](docs/transform.md).

### Saving and browsers

In Chromium-based browsers (Chrome, Edge, Opera), Open and Save use the system file dialogs and
Save writes back to the same file, including a `.soup` file dropped on the page. Other browsers
(Firefox, Safari) open files with the browser's file chooser, and every Save downloads a new
copy instead. Browsers usually keep Ctrl/Cmd+N for opening a new window, so in a normal tab use
File → New instead.

## Requirements

- Node.js 22.13+, 24.x, or 26+ (the range supported by Vite 7, Vitest 5 and ESLint 10) with npm
- A modern browser (Chrome, Edge, Firefox or Safari)

## Getting started

```sh
npm install
npm run dev
```

Then open http://localhost:1619.

To build and serve a production version:

```sh
npm run build     # outputs static files to dist/
npm run preview
```

The `dist/` folder is a static site and can be hosted anywhere: at a domain's root, or under a
path set with `VITE_BASE` at build time (the GitHub Pages mirror uses `VITE_BASE=/Pixelsoup/`).
See [docs/deploy.md](docs/deploy.md) for the Cloudflare and GitHub Pages deployments and rollback.

## Development

```sh
npm test          # unit tests (Vitest)
npm run lint      # ESLint + Prettier check
npm run format    # apply Prettier formatting
```

Architecture, conventions and the roadmap are documented in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
