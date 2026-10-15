# feat: Free Transform, Edit → Transform, and Rotate Layer's removal

## Summary

The transform half of build-order step 12: Photoshop-style Free Transform on top of the
existing `TransformLayerCommand`, affine helpers and premultiplied resampling. It replaces
the Rotate Layer dialog, which is removed.

- **Free Transform** (Edit → Free Transform, Ctrl/Cmd+Alt+T, or the canvas's context menu)
  moves, scales and turns the active layer. With a selection it lifts the selected pixels
  into a floating selection first, as the Move tool does, and transforms them outline and
  all; a floating selection is transformed as it is. A hidden layer starts nothing, and the
  status bar says why.
- **Handles on the canvas**: corners scale both axes and edges one, about the opposite
  handle, or about the pivot with Alt. Shift keeps the proportions on corners. Dragging just
  outside a corner turns the layer about its pivot, with a rotate cursor, and Shift snaps to
  15° steps. Inside the box a drag moves the layer (Shift: along one axis), and the arrow keys
  nudge by 1 px, 10 with Shift. Enter, a double-click inside or ✓ applies; Esc or ✗ cancels.
- **Options bar**: X and Y of the pivot, W and H in % or px with a keep-proportions toggle,
  the angle, the interpolation (Bilinear by default, or Nearest neighbour), ✓ and ✗. The
  fields and the handles follow each other, typing previews straight away, and values out of
  range are refused as in other number fields.
- **Live preview on the overlay, not through history**: the composite leaves the layer out
  while the overlay draws its untransformed pixels through the view × the session's affine.
  The document isn't touched until the transform is applied, and panning and zooming keep
  working.
- **One undo step**: applying runs one `TransformLayerCommand` named "Free Transform" (or
  "Scale", "Rotate"). A transform that changes nothing adds no step. Cancelling adds nothing,
  and undoes a lift the session made itself. Anything else that would change the document
  (a command, another layer or tool, Save, Save As, Export, New, Open, a dropped file)
  applies it first.
- **Edit → Transform**: Scale and Rotate start a session limited to scaling or turning. Flip
  Horizontal and Vertical, Rotate 180°, 90° Clockwise and 90° Anticlockwise are composed into
  a running session, or else turn the active layer straight away through the lossless
  orientation path (the new `OrientLayerCommand`), one undo step each, so two flips give back
  identical bytes.
- **Rotate Layer is gone**: Image → Rotate Layer…, its dialog, its preview through history and
  `rotateLayerCommand`. Image → Rotate 90° / 180° and the flips, which turn the whole canvas,
  stay.

No new dependencies.

## What's included

Commits are meant to be reviewed one at a time:

1. **Free Transform sessions and their math** (`src/ui/transform`, `editor.ts`,
   `tool-manager.ts`, `tool.ts`):
   - `transform-math.ts`: the session's parameters (where the pivot goes, the scale along the
     layer's own axes, the angle) and `transformAffine`, which rebuilds the `Affine` from them
     on every change, so nothing drifts during a long drag. Scaling about the opposite handle
     or the pivot, proportional scaling, rotation and its snapping, whole-pixel moves,
     handle hit-testing in CSS pixels, cursors, and the options-bar fields.
   - `TransformSession` (a `ToolSession`) and the `FreeTransform` controller, which lifts a
     plain selection first.
   - `ToolManager.startSession` / `endSession`: a session takes over the pointer, keys,
     cursor, overlay and options bar without changing the active tool; choosing a tool
     applies it first.
   - `Editor` gains a pending edit (`beginPending`, `applyPending`, `cancelPending`), applied
     before another layer becomes active, a floating selection commits or another pending edit
     begins, and dropped by `replaceDocument`.
2. **Overlay preview** (`split-compositor.ts`, `composite-renderer.ts`,
   `selection-overlay.ts`, `viewport-controller.ts`):
   - `CompositeRenderer.suppress(layerId)`: a `SplitCompositor` composites the layers below
     the suppressed one into the main image and the layers above it onto transparency, so
     the overlay can draw the transformed layer between them. Only the areas a suppression
     affects are composited again, and the layer comes back exactly afterwards.
   - The overlay puts the layer's pixels on an offscreen canvas once per session and draws it
     each frame through the view and the session's affine, at the layer's opacity, clipped to
     the canvas. Smoothing follows the interpolation (always on below 100 %, as the
     composite's is). Then it draws the box with its handles and the pivot ring in screen
     space, snapped to device pixels while the box is upright. The ants hide meanwhile.
3. **Options bar** (`TransformOptionsPanel.tsx`, `OptionsIcon.tsx`): the fields above; the
   tick and cross icons move out of the Crop tool's panel to be shared.
4. **Menus, shortcut and lossless layer turns** (`EditMenu.tsx`, `MenuList.tsx`,
   `canvas-menu.ts`, `use-transform-shortcuts.ts`, `transform-commands.ts`, `affine.ts`):
   - Edit → Free Transform and the Edit → Transform submenu. `MenuList` gains submenus
     (hover, ArrowRight or Enter opens; ArrowLeft or Escape closes), for the menu bar and
     context menus alike.
   - `OrientLayerCommand` turns or flips one layer exactly; a floating selection turns with
     its outline.
   - The context menu offers Free Transform with or without a selection. During a session it
     shows only the session's flips and turns, Apply and Cancel.
   - Undo during a session cancels it (the Edit menu shows "Undo Free Transform"), and Redo is
     off meanwhile. `AppController.confirmDiscard` applies the session before New, Open,
     Close, the demo or a dropped file replaces the document.
   - `alignToPixels` rounds half away from zero, so a quarter turn and back puts a layer back
     where it was.
5. **Remove Rotate Layer**: the menu item, `RotateLayerDialog`, `layer-rotation.ts`,
   `rotateLayerCommand` and its tests (now `TransformLayerCommand` tests of pixel-aligned
   rotations), the frame clock it needed in `AppController`, and its CSS.
6. **Draw the preview from halved copies** (`canvas-pyramid.ts`): Chromium draws a canvas
   with mipmapped smoothing by making a fresh mipmapped copy on every draw, 35–40 ms for a
   6400 × 4000 layer. `CanvasPyramid` keeps copies at a half, a quarter, … of the size, each
   made once when first needed, and the overlay draws the smallest copy still at least as
   large as on screen with plain bilinear filtering. The layers above get one too.
7. **Docs**: a "Free Transform" section in `docs/transform.md` (the session, the preview,
   applying, cancelling, the pending edit, Edit → Transform, the shortcut and frame times);
   in `docs/tools.md`, tool sessions, the transform overlay, the context menu during a
   session, and a Free Transform section with "What applies it first" next to the
   floating-selection commit rules; `docs/layers.md`; README features and a Free Transform
   shortcuts table. CLAUDE.md marks the transform half of step 12 done and stays at 199
   lines.

## Design notes

- **Ctrl/Cmd+Alt+T, not Ctrl/Cmd+T**: browsers open a new tab on Ctrl/Cmd+T and never pass it
  to the page. Photopea uses Alt+Ctrl+T for the same reason. Where Option or AltGr makes T type
  another character (Option+T types † on a Mac), the key is matched by its position. Ubuntu's
  desktop opens a terminal on Ctrl+Alt+T; the Edit menu works there.
- **Parameters, not accumulated matrices**: every drag starts from the parameters at the press
  and rebuilds the affine, so a long drag or many field edits never drift. Whole turns and
  flips at 100 % are aligned to pixels, so they apply exactly even with bilinear filtering.
- **A pending edit rather than a modal tool**: the session isn't a tool, so the active tool
  stays as it was, and the editor applies the session before any command runs. That gives
  "apply before anything else edits the document" for every menu, panel and tool without
  each of them knowing about Free Transform: the floating selection's commit rule, one level
  up.
- **Undo cancels**: undoing during a session takes back the whole transform (and the lift it
  made) rather than stepping back through the drags, which aren't history steps.
- **Oversize results**: applying explicitly (Enter, a double-click, ✓) refuses a result over
  8192 px on a side with a message, and the session goes on. Applied implicitly (by a tool
  switch, say), it keeps the part on the canvas, as `TransformLayerCommand` does, with a
  message, since there's nowhere to go back to.
- **Edit → Transform's flips and turns with no session** act on the whole active layer, even
  under a plain selection, which stays as it is; within a session they compose into it.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 1006 tests across 81 files
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover (new files: `transform-math`, `transform-session`, `split-compositor`,
`canvas-pyramid`, `use-transform-shortcuts`):

- **Composition**: the identity; scaling about the opposite corner, about the pivot with Alt,
  proportionally with Shift, from an edge, along a turned box's own axes; flipping past the
  anchor while keeping at least a pixel; rotation by the swept angle, snapping to 15°, kept
  within (−180°, 180°]; whole-pixel moves and Shift's axis; flips and turns composed about
  the pivot, a double flip and four quarter turns coming back.
- **Hit-testing**: handles, inside and the rotate zone at 100 % and other zooms (reach in CSS
  pixels), Scale and Rotate modes, a turned and flipped box; resize and rotate cursors.
- **Options-bar fields**: round trips to the same transform in px and %, scaling about the
  pivot with the lock, refusing values out of range, display precision.
- **Sessions through the `ToolManager` with `FakeViewport`**: the preview leaves the document
  and history alone; Enter applies exactly one step with the expected transform; Escape
  leaves history and the layer untouched; an unchanged transform adds no step; moves, nudges,
  Shift and Alt pressed or released mid-drag, rotation with and without snapping; Escape
  mid-drag puts the box back and a second cancels; double-click applies; a selection is
  lifted, transformed with its outline and the lift undone on cancel; a floating selection
  transformed as it is; a hidden layer refused; a tool switch or any command applying it
  first, undo cancelling it, a replaced document ending it; oversize results refused or cut
  to the canvas; the interpolation; switching between Free Transform, Scale and Rotate; the
  context menu's items.
- **Edit → Transform**: lossless turns and flips, one step each, back to the same bytes and
  place; the whole layer under a selection; a floating selection with its outline; composing
  into a running session; a hidden layer refused.
- **Rendering**: `SplitCompositor` leaves a layer out and composites the layers above it on
  their own, puts the layer back exactly after changes, and leaves out a session's layer until
  it's applied or cancelled. `CanvasPyramid` picks the right level and makes copies lazily.
- **Core**: `OrientLayerCommand`, pixel-aligned quarter turns staying exact under bilinear
  filtering, `alignToPixels`' rounding, and the editor's pending edit.
- **Shortcut**: Ctrl+Alt+T and Cmd+Option+T, matching by key position, leaving Ctrl/Cmd+T to
  the browser.

These checks were run with scripts driving headless Microsoft Edge through the DevTools
protocol, with real pointer and key events, against a local dev server, not the Cloudflare
preview, which needs the branch pushed. Everything passed:

- **Interaction** (25 checks, on a 1464 × 2022 photo at 33 %): Ctrl+Alt+T started a session.
  A corner drag scaled freely about the opposite corner; with Shift proportionally; with Alt
  about the pivot; with Shift+Alt both. The cursor just outside a corner was the rotate arrow;
  a 37° sweep turned the layer 37°, and 30° with Shift. Moves went by whole pixels, and with
  Shift along one axis. Typing 45 in Angle previewed the turn (clipped to the canvas, the box
  reaching past it, 2466 × 2466 in the status bar) with no history step. After each Esc and ✗
  the history and the layer's pixel buffer were exactly as before. Enter added exactly one
  "Free Transform" step, and Ctrl+Z gave back the original buffer; a double-click inside
  applied too.
- **Elliptical selection**: Ctrl+Alt+T lifted it into a floating selection and transformed
  that. After a 30° turn and Enter the float stayed, and its pixels with any alpha matched the
  selection's coverage exactly (no pixel on one side only). Undoing twice brought back the
  plain selection; Esc after a fresh lift undid the lift, leaving "Lift Selection" on the redo
  stack and the source's pixels untouched.
- **Quality**: a 50 % scale and 30° turn on a 6400 × 4000 photo, compared at fit and at
  800 % on a corner: the preview matched the applied result at fit, and the applied edge was
  cleanly anti-aliased at 800 %.
- **Menus**: Edit → Transform's flips came back to identical bytes after two.
- **Frame times** (headless Edge, an RTX 2000 Ada laptop, each photo fitted to the window):

  | Photo                    | Scale / rotate drag, mean (p95) | Start    | Apply a 45° turn |
  | ------------------------ | ------------------------------- | -------- | ---------------- |
  | 1920 × 1200 (51 %)       | 16.7 ms (16.8)                  | 25–40 ms | 0.34 s           |
  | 6400 × 4000 (15 %)       | 16.7 ms (16.9)                  | 150 ms   | 3.6 s            |
  | 6400 × 4000, pre-pyramid | 31.6 ms (66.7) / 28.7 ms (66.7) |          |                  |

  With a copy of the 6400 × 4000 layer above it, a turn from the Angle field took about 28 ms
  a frame, against 124 ms before the pyramid.

In the browser (on the Cloudflare preview once pushed):

- [ ] Open a large photo, press Ctrl+Alt+T (Cmd+Option+T): drag corners, edges, with Shift
      and Alt; turn from just outside a corner, with Shift. It stays smooth.
- [ ] Type 45 in Angle: the preview turns. Esc: nothing in Edit → Undo.
- [ ] Transform again and press Enter: one "Free Transform" step. Zoom to 800 % on an edge.
- [ ] Make an elliptical selection, Ctrl+Alt+T, turn it, Enter: the ants follow the pixels.
- [ ] Edit → Transform → Flip Horizontal twice: back to the start, two undo steps.
- [ ] Right-click during a session: flips, turns, Apply and Cancel.

## Known limitations

- **The preview is the browser's bilinear filtering** (from halved copies when shrunk), not
  the premultiplied resampling that applying uses, so the two can differ a little at soft
  edges. Applying resamples on the CPU, on the main thread: 3.6 s for a 6400 × 4000 layer
  turned 45°.
- **No skew, distort, perspective or warp**, and the pivot stays at the layer's centre: the X
  and Y fields place it, but it can't be dragged elsewhere.
- **Undo** cancels the whole session rather than its last change.
- **Repeated transforms** each resample and round to 8 bits, softening the pixels a little.
- **Panning huge documents** is slow for the same reason the preview was: the composite is
  drawn with mipmapped smoothing below 100 %, 57 ms a frame for 6400 × 4000 at fit. Drawing it
  from a `CanvasPyramid` would fix that; it predates this branch.
- **Not tried here**: the Cloudflare preview, a Mac, Firefox and Safari, touch and pens.

## Deliberately out of scope

- Skew, distort, perspective and warp; a draggable pivot; reference-point presets.
- Transforming several layers at once, and transforming a selection's outline alone.
- A GPU or worker resampler for applying.
