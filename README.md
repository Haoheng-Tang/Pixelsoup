# Pixelsoup

An open-source, layered raster image editor that runs in your browser, like a lightweight
Photoshop.

> Early days: Pixelsoup can create, open, save, import and export documents, manage their
> layers (add, duplicate, reorder, rename, merge, flatten, show, hide and fade them), make
> rectangular and elliptical selections, move layers and selected pixels, and paint and erase
> with soft or hard brushes. Cropping, adjustments and other tools are on the roadmap.

## Features so far

- New documents up to 8192×8192 pixels with a white or transparent background
- Native layered `.pixelsoup` files (a zip of `document.json` plus one PNG per layer; see
  [docs/file-format.md](docs/file-format.md)) that keep every layer's pixels exactly
- Open PNG, JPEG and WebP images as new documents, or import them as a centred new layer
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
- Rectangular and elliptical marquee tools (the ellipse has anti-aliased edges) in New, Add,
  Subtract and Intersect modes, picked in the tool-options bar or with modifier keys
- Select menu: Select All, Deselect and Inverse
- Marching ants that stay a hairline wide and track the canvas exactly at every zoom level
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
- Status bar with the pointer's document position, the selection size, and brief messages such
  as a new brush size
- Undo/redo for every edit, selection changes included (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y)

### Selection shortcuts

| Keys                                | Action                                                |
| ----------------------------------- | ----------------------------------------------------- |
| M                                   | marquee tool (Shift+M switches rectangle and ellipse) |
| Ctrl/Cmd+A, Ctrl/Cmd+D              | select all, deselect                                  |
| Ctrl/Cmd+Shift+I                    | inverse                                               |
| Shift, Alt, Shift+Alt at drag start | add to, subtract from, intersect with the selection   |
| Shift during a drag                 | constrain to a square or circle                       |
| Alt during a drag                   | draw from the centre                                  |
| Click without dragging              | deselect                                              |
| Esc during a drag                   | cancel                                                |

Shift or Alt used to pick the mode at the start of a drag constrain or centre the shape only
after being released and pressed again. With no selection, they constrain straight away.
Selections aren't saved in `.pixelsoup` files, and changing one doesn't count as an unsaved
change. Some browsers keep Ctrl/Cmd+D (bookmark) or Ctrl/Cmd+Shift+I (developer tools) for
themselves; the Select menu always works.

### Layer shortcuts

| Keys                       | Action                               |
| -------------------------- | ------------------------------------ |
| Ctrl/Cmd+Shift+N           | new layer above the active one       |
| Ctrl/Cmd+J                 | duplicate the active layer           |
| Ctrl/Cmd+E                 | merge down                           |
| Ctrl/Cmd+[, Ctrl/Cmd+]     | move the active layer down, up       |
| Alt+[, Alt+]               | select the layer below, above        |
| Double-click a name, or F2 | rename (Enter keeps it, Esc cancels) |
| Drag a layer               | reorder (Esc cancels)                |

Selecting a layer isn't an edit: it isn't saved and isn't an undo step. Merge Down needs both
layers visible. Flatten Image discards hidden layers. Browsers may keep Ctrl/Cmd+Shift+N for a
new private window; Layer → New Layer and the panel's button always work.

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
save or export, so a saved file never contains one. Each lift, move and commit is an undo step,
and undoing a commit floats the pixels again.

### Painting shortcuts

| Keys                        | Action                                         |
| --------------------------- | ---------------------------------------------- |
| B, E, I                     | brush, eraser, eyedropper                      |
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
The colours aren't saved, and changing them isn't an undo step.

### Saving and browsers

In Chromium-based browsers (Chrome, Edge, Opera), Open and Save use the system file dialogs and
Save writes back to the same file. Other browsers (Firefox, Safari) open files with the
browser's file chooser, and every Save downloads a new copy instead. Browsers usually keep
Ctrl/Cmd+N for opening a new window, so in a normal tab use File → New instead.

## Requirements

- Node.js 22.13+, 24.x, or 26+ (the range supported by Vite 7, Vitest 5 and ESLint 10) with npm
- A modern browser (Chrome, Edge, Firefox or Safari)

## Getting started

```sh
npm install
npm run dev
```

Then open http://localhost:5173.

To build and serve a production version:

```sh
npm run build     # outputs static files to dist/
npm run preview
```

The `dist/` folder is a static site and can be hosted anywhere.

## Development

```sh
npm test          # unit tests (Vitest)
npm run lint      # ESLint + Prettier check
npm run format    # apply Prettier formatting
```

Architecture, conventions and the roadmap are documented in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
