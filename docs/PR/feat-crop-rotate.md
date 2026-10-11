# feat: Crop tool, canvas turns and flips, Image Size, Canvas Size and Rotate Layer

## Summary

Step 8 of the build order: Pixelsoup can crop, resize, turn and resample. It also builds the
resampling core that step 12's Free Transform will reuse.

- **Crop tool (C)**: draw a box, then resize it with eight handles or move it. Shift keeps its
  shape, Alt works from the centre, and an aspect preset (Free, Original, 1:1, 4:3, 3:2, 16:9
  or Custom W:H) reshapes it. Outside the box is dimmed, and a rule-of-thirds grid shows while
  it's adjusted. A box past the canvas enlarges it with transparent space. Enter, a
  double-click inside or ✓ crops; Esc or ✗ cancels. With a selection, the box starts as its
  bounds. "Delete cropped pixels" (off by default) trims the layers; otherwise they keep the
  pixels outside the canvas.
- **Image menu**: Crop to Selection; Image Size… (pixels or percent, aspect lock, nearest
  neighbour or bilinear); Canvas Size… (absolute or relative, a 3 × 3 anchor grid and a ⇄
  button that swaps width and height); Rotate 90° CW, 90° CCW and 180°; Flip Horizontal and
  Vertical; and Rotate Layer… by any angle, with a live preview.
- **Lossless turns and flips**: every layer's pixels and position, and the selection, are
  remapped exactly. Four quarter turns, two half turns or two flips give back the same bytes.
- **Resampling never darkens edges**: interpolation weights colour by alpha (premultiplied), so
  halfway between opaque red and transparency is red at half alpha, not dark red.

Every operation is one undo step that restores the exact bytes, and each commits a floating
selection first, except Rotate Layer on the floating selection itself, which turns the pixels
and the ants together. The `.pixelsoup` format is unchanged.

## What's included

Commits are meant to be reviewed one at a time:

1. **`ResizeCanvasCommand` for crop and canvas size** (`canvas-commands.ts`):
   - `ResizeCanvasCommand(width, height, offsetX, offsetY, { label, trim })` gives the canvas a
     new size and moves every layer by the offset. Layers keep all their pixels (they may
     extend past the canvas), so undo restores the size, offsets and selection without copying
     a pixel.
   - `cropCommand(doc, area)` and `canvasSizeCommand(doc, w, h, horizontal, vertical)` build
     one; `anchorOffset` places the image at the start, centre or end of each axis, and
     centring truncates toward zero so growing and shrinking back round-trips.
   - `trim` (Delete cropped pixels) cuts each layer to the canvas, keeping what it cut as up to
     four `PixelSnapshot` bands for an exact undo. A layer with nothing left becomes a
     transparent canvas-sized one. Trimmed layers are listed in `layerPixels`.
   - `Selection.resizeCanvas` moves the selection and cuts it to the new canvas, or clears it.
   - The viewport keeps its zoom and recentres when the canvas changes size.
2. **Lossless canvas rotations and flips** (`orientation.ts`, `orientation-commands.ts`):
   `orientPixels`, `orientRect` and `Selection.orient` remap pixels, layer rects and masks for
   each orientation. `OrientCanvasCommand` applies one to every layer and the selection, and
   undo applies the inverse.
3. **Resampling engine** (`src/core/resample`):
   - `kernels.ts`: `Interpolation` (`'nearest' | 'bilinear'`) and separable `Kernel`s with a
     `support`, so bicubic needs only its name, its kernel and a dialog label. Results are
     clamped, so kernels with negative lobes work. `storePremultiplied` turns Σw·a and Σw·a·c
     back into straight alpha, rounding halves up.
   - `resize.ts`: `resizePixels(source, width, height, interpolation)`. Pixel centres line up,
     so nearest neighbour is exact at whole-number scales; shrinking stretches the kernel so a
     uniform image stays uniform; taps past the edges are dropped and the rest renormalised.
   - `affine.ts`: the `Affine` type (`setTransform` order), `rotation` (exact at multiples of
     90°), `multiply`, `aboutPivot`, `invert`, `transformedBounds` and `alignToPixels`.
   - `transform.ts`: `transformPixels(source, m, interpolation, clip?)` returns a new buffer
     plus its position, covering the whole-pixel bounds of the transformed corners. Outside the
     source counts as transparent, so new edges are anti-aliased. `transformMask` does the same
     for coverage masks (`Selection.transform`).
4. **Transform and image size commands**:
   - `TransformLayerCommand(layerId, affine, interpolation, { label, floating })` replaces one
     layer's buffer and offset; undo restores the old buffer. `rotateLayerCommand` turns a
     layer about the centre of its bounds, bilinear and aligned to pixels.
   - On a floating selection's layer it transforms the selection as lifted through the same
     matrix, so the ants match the pixels, and marks the float `edited` so committing it in
     place keeps the resampled pixels.
   - `ResampleDocumentCommand` (`imageSizeCommand`) resamples every layer and its offset by the
     same factors, with edges rounded to whole pixels so layers that met still meet. It
     changes the canvas size and clears the selection.
   - Results larger than 8192 pixels on a side keep only the part on the canvas. Both commands
     keep whole buffers for undo and redo (see Known limitations).
5. **The Crop tool** (`crop-tool.ts`, `crop-geometry.ts`, `crop-options.ts`,
   `CropOptionsPanel.tsx`):
   - Hit-testing: a press within 6 CSS px of an edge drags it (both edges near a corner),
     inside moves the box, and outside draws a new one. An edge reaches in at most a third of
     the box, so a small box keeps a middle to move it by. Dragging past the opposite edge
     flips the box. A drag takes hold after 3 CSS px.
   - Ratios fit a portrait box as well as a landscape one (the drag's direction decides while
     drawing, the box's shape while resizing); changing the ratio reshapes the box about its
     centre, keeping its area. Custom terms go up to 10000, decimals allowed.
   - Escape mid-drag, pointer cancel and window blur put back the box from before the press.
     A box over 8192 pixels on a side is refused with a message.
   - `CropOverlay` on the selection overlay: shading outside the box, the added area as a
     checkerboard continuing the composite's (now shared in `checkerboard.ts`), the grid, and
     7 CSS px handles on the device pixel grid. The status bar shows the box's size.
   - The viewport routes double-clicks to the tool (`Tool.doubleClick`), and a `KeyGate` keeps
     keys away from tools while a dialog is open, so Enter and Escape reach the dialog. This
     also stops the Move tool's arrow-key nudges reaching the document behind a dialog.
6. **The Image menu and its dialogs**:
   - `image-actions.ts` runs the direct actions (Crop to Selection, the turns and flips),
     committing a floating selection first, and disables items that would do nothing.
   - `ImageSizeDialog`, `CanvasSizeDialog` and `RotateLayerDialog`, with a shared
     `NumberField` and the pure field arithmetic in `size-math.ts`. `ModalHost` mounts them;
     `AppController` runs them and remembers their settings for the session
     (`image-options.ts`).
   - **Rotate Layer** previews through history (`layer-rotation.ts`): at most once a frame it
     undoes the last rotation and turns the original pixels afresh, so the canvas, thumbnail
     and ants show exactly what OK keeps and resampling never compounds. With a selection it
     lifts the selected pixels first ("Rotate Selection"). Cancel undoes everything, leaving it
     redoable; a whole number of turns keeps nothing. The dialog sits top-right with no
     backdrop (`Dialog` gains a `className`).
7. **Docs**:
   - New `docs/transform.md`: the command summary, canvas size and cropping, turns and flips,
     the resampling design and premultiplied rule, Image Size, transforming a layer, the Image
     menu and open decisions. Imported from `CLAUDE.md`.
   - `docs/tools.md`: the Crop tool, double-click routing, the key gate and the crop overlay.
     `docs/layers.md`: what commits a floating selection now, and Rotate Layer on a float.
   - `CLAUDE.md` marks step 8 done and adds `resample/` and the transform commands to the
     layout, staying at 199 lines. The README lists the Crop tool and Image menu, with a crop
     shortcuts table.
8. **Width and height swap in Canvas Size**: a ⇄ button between the fields turns a landscape
   canvas portrait or back. With Relative it swaps the sizes the changes give and works the
   changes out again: on 3840 × 2400, +200 and +100 (4040 × 2500) become −1340 and +1640
   (2500 × 4040). It comes after Height in the Tab order, and a click leaves the focus where it
   was, so Enter still resizes. `swapSideText` in `size-math.ts`, with tests.

## Design notes

- **Crops move layers, they don't cut them**: a crop is a smaller canvas plus an offset, so
  crops and Canvas Size are instant, copy no pixels, and undo is exact for free. Deleting
  cropped pixels is the opt-in, as in Photoshop.
- **Orientation is exact, not resampled**: quarter turns and flips are index remaps, so they're
  lossless and round-trip byte for byte. The affine path agrees with them within ±1 per channel
  at 0° and 90° (tested), but isn't used for them.
- **Premultiplied interpolation everywhere**: resizing, transforms and mask transforms all go
  through one rule, so no code path can darken an edge next to transparency.
- **Kernels as data**: interpolation is a separable kernel with a support, so adding bicubic
  touches three places and no loops.
- **Rotate Layer previews through history**, not on the overlay: the preview is the real
  command, so the thumbnail and ants match what OK keeps and there is no second rendering path.
  It always resamples from the original pixels, so dragging the slider never compounds. The
  cost is a full-layer CPU resample per frame (see Known limitations).
- **Whole buffers for Image Size and transforms**: every pixel changes, so tiles would save
  nothing; this matches merges.
- **Selection follows the canvas**: crops and Canvas Size move and cut it, turns and flips
  remap it, transforms of a floating selection turn it, and Image Size clears it.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 642 tests across 56 files (170 new, in 12 new files)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover:

- **ResizeCanvas**: offsets for each anchor, crop areas, enlarging, selection re-cut and
  clearing, undo exactness, Delete cropped pixels and its snapshot restore, `layerPixels` and
  dirty rects.
- **Orientation**: pixel positions after each rotation and flip on a small asymmetric layer
  with an offset; byte-identical round trips; selection masks transforming identically to
  pixels.
- **Resampling**: nearest exact at integer scales; bilinear at 2× against hand-computed values;
  opaque red beside transparent interpolating to red at half alpha; a uniform image staying
  uniform when shrunk; affine rotation by 0° and 90° matching the lossless commands within ±1;
  output bounds for a rotated rectangle; mask transforms.
- **Commands**: TransformLayer and ResampleDocument undo and redo restore exact bytes; a
  floating selection's transform keeps mask and pixels aligned; oversized results; null cases.
- **Crop tool**: pointer sequences with `FakeViewport`: draw, handle drags, move, Shift aspect,
  Alt from the centre, flipping, every ratio preset, enlarging beyond the canvas, commit via
  Enter, double-click and ✓, Esc, cancel mid-drag, start from a selection. Crop geometry is
  tested on its own.
- **Image menu and dialogs**: action enabling and floating-selection commits, `AppController`
  flows for each dialog including Rotate Layer's preview, Cancel and Rotate Selection, and the
  size field arithmetic including the swap.

In the browser, with a photo open:

- [ ] Crop with each aspect preset, landscape and portrait; Shift and Alt while dragging.
- [ ] Crop larger than the canvas: the added area is transparent.
- [ ] Crop to Selection, and the Crop tool starting from a selection.
- [ ] Image Size down to 50 % and up to 200 % with both methods, on a layer with transparent
      edges: no dark fringes.
- [ ] Canvas Size with a corner anchor, absolute and relative; ⇄ swaps width and height.
- [ ] Each rotation and flip, and their round trips.
- [ ] Rotate Layer by 15° on a layer with soft edges; then with a selection (Rotate Selection).
- [ ] Undo through all of it back to the original.

These checks were run with a script driving headless Microsoft Edge through the DevTools
protocol, with real pointer and key events, on a 3840 × 2400 photo plus a soft red brush layer
offset by (30, 20). Each step was checked by saving the document and comparing the decoded layer
bytes. It ran against `npm run preview` (the same `dist/` Cloudflare serves) rather than the
Cloudflare preview, which needs the branch pushed. All 61 checks passed with no console errors
and no CSP violations:

- **Crop handles**: drawing, an edge handle, moving, Shift on a corner and Alt on an edge gave
  the expected boxes; committing moved the layers by the crop's origin with their bytes
  unchanged.
- **Ratio presets**: Free, Original, 1:1, 4:3, 3:2, 16:9 and 5:2, each dragged landscape and
  portrait. Original and the presets turned for a portrait drag; 1:1 and Custom stayed exact.
  Enter, double-click and ✓ each cropped as one step; ✗ left no step.
- **Crop past the canvas**: the layers moved by about (300, 200) with identical bytes, and the
  added area showed as checkerboard.
- **Delete cropped pixels**: every layer ended at (0, 0), canvas-sized; undo restored them.
- **Crop to Selection** matched the selection's bounds.
- **Canvas Size** relative +200/+100 anchored bottom right moved the layers by (200, 100), and
  absolute 3000 × 2000 anchored top left left them in place.
- **Turns and flips**: every pixel mapped as expected, and repeating each back to the start
  gave identical bytes. CW, Flip H, CCW equalled a vertical flip.
- **Image Size** 50 % and 200 %, bilinear and nearest: offsets scaled, sizes rounded. Bilinear
  edges stayed within 1 level of pure red with coverage within 1 %; nearest added no new
  colours and gave exact 2 × 2 blocks at 200 %.
- **Rotate Layer 15°**: bounds within ±3 px of the analytic 4330.3 × 3312.1, centred on the
  layer; soft edges within 1 level of pure red; the photo layer unchanged. Esc at 30° left no
  step.
- **Rotate Selection −20°**: lifted into "Floating selection" with the ants matching the pixels;
  three undos restored it.
- **A chain** of crop, Canvas Size, CW, Flip V, Image Size 75 % and Rotate 15° undid in six
  steps to identical bytes, and redid to identical bytes.
- **Undo everything** returned to the opened photo byte for byte.
- **The swap button**, on the dev server: 1920 × 1080 swapped to 1080 × 1920 and resized to it;
  relative +200/+100 swapped to −740/+1040 (1180 × 2120) and back; Tab order, Enter and Space
  on the button, and the button's alignment with the fields all checked.

## Known limitations

- **Memory**: Image Size and transforms keep each layer's old and new buffers whole: 9 MB and
  37 MB for a 1920 × 1200 layer taken to 200 %. Crops and Canvas Size copy nothing.
- **Rotate Layer preview** resamples the whole layer each frame on the CPU; very large layers
  preview slowly. An overlay or GPU preview would fix it.
- **Repeated transforms** each round to 8 bits, so rotating by 15° twice isn't quite rotating by
  30° once.
- **Oversized results** (past 8192 pixels on a side) keep only the part on the canvas.
- **Image Size clears the selection** rather than scaling it, and keeps the zoom (recentring the
  canvas) rather than fitting it to the view.
- **No shortcuts** in the Image menu: Photoshop's use Ctrl+Alt, which is AltGr on many keyboards.

## Deliberately out of scope

- **Free Transform** and its on-canvas handles (step 12); this branch builds the resampling core
  and `TransformLayerCommand` it will reuse.
- **Bicubic and other kernels**: the interface is ready for them.
- **Straighten, perspective crop and crop to a rotated box.**
- **Resolution (DPI)** in Image Size: Pixelsoup works in pixels only.
