# Cropping, rotation and resampling

How the canvas is cropped, resized, turned and flipped, and how layers are resampled. The code
lives in `src/core/resample` (interpolation, resizing, affine transforms),
`src/core/orientation.ts` (quarter turns and flips), `src/core/commands` (`canvas-commands.ts`,
`orientation-commands.ts`, `image-size-commands.ts`, `transform-commands.ts`),
`src/ui/image-actions.ts` and `src/ui/panels/ImageMenu.tsx` (the Image menu),
`src/ui/session/layer-rotation.ts` (Rotate Layer's preview) and `src/ui/dialogs`. The Crop tool
is described with the other tools: [tools.md](tools.md#crop-tool).

## Commands

| Command                   | Factories                                                 | Used by                                     | Kept for undo                       |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| `ResizeCanvasCommand`     | `resizeCanvasCommand`, `cropCommand`, `canvasSizeCommand` | Crop tool, Crop to Selection, Canvas Size…  | no pixels; with `trim`, what it cut |
| `OrientCanvasCommand`     | the constructor                                           | Rotate 90° / 180°, Flip Horizontal/Vertical | no pixels: undo applies the inverse |
| `ResampleDocumentCommand` | `imageSizeCommand`                                        | Image Size…                                 | every layer's old and new pixels    |
| `TransformLayerCommand`   | `transformLayerCommand`, `rotateLayerCommand`             | Rotate Layer…, and Free Transform later     | the layer's old and new pixels      |

All are single undo steps, and the factories return null when their command would change
nothing. Each commits a floating selection first (the Crop tool, `runImageAction` and
`AppController` do it, as a step of its own), except a `TransformLayerCommand` on the floating
layer itself, which transforms the float instead.

## Canvas size and cropping

`ResizeCanvasCommand(width, height, offsetX, offsetY, { label, trim })` gives the canvas a new
size and moves every layer by the offset: what was at (x, y) ends up at (x + offsetX,
y + offsetY). A crop to `area` is a canvas the size of `area` moved by (−area.x, −area.y), so
`cropCommand(doc, area)` ("Crop") and `canvasSizeCommand(doc, w, h, horizontal, vertical)`
("Canvas Size") both build one.

- Layers keep all their pixels, on the canvas or past its edges, so undo restores the size,
  the offsets and the selection without copying a pixel. Area added beyond the old canvas is
  transparent.
- The selection moves with the layers and is cut to the new canvas (`Selection.resizeCanvas`),
  or cleared if none of it is left.
- **Delete cropped pixels** (`trim`) cuts each layer to the new canvas instead, keeping what it
  cut (up to four `PixelSnapshot` bands) so that undo restores the layer byte for byte. A layer
  with nothing left on the canvas becomes a transparent canvas-sized one. Trimmed layers are
  listed in `layerPixels`.
- `anchorOffset` keeps the image against the start, centre or end of each axis. Centring
  truncates toward zero, so growing the canvas and shrinking it back by the same amount puts
  the image back where it was.

## Turns and flips

`OrientCanvasCommand(orientation)` turns the canvas 90° clockwise or anticlockwise or 180°, or
flips it horizontally or vertically. Every layer's pixels and position, and the selection
(`Selection.orient`), move exactly as the canvas does (`orientPixels`, `orientRect`), with no
resampling, and layers past the canvas's edges turn with it. Undo applies the inverse, so four
quarter turns, two half turns or two flips give back the same bytes.

## Resampling

`src/core/resample` resamples pixels for Image Size and layer transforms. It knows nothing of
documents or commands.

- **Interpolation**: `'nearest'` copies whole pixels; `'bilinear'` weights nearby pixels with a
  triangle `Kernel`. Kernels are separable (a weight for a distance along one axis, zero from
  their `support` on), so **bicubic** needs only its name in `Interpolation`, its kernel in
  `kernelFor` and a label in the Image Size dialog's list. Results are clamped, so kernels with
  negative lobes work.
- **The premultiplied rule**: filtering always weights colour by alpha. An output pixel's alpha
  is Σw·a and its colour Σw·a·c / Σw·a (`storePremultiplied`), so a transparent pixel lends no
  colour however much weight it gets, and edges next to transparency never darken: halfway
  between opaque red and transparent black is red at half alpha (255, 0, 0, 128), not dark red.
  Alpha rounds to the nearest level, halves up (`toByte`; a `Uint8ClampedArray` would round
  halves to even), and a result with no alpha stays transparent black.
- **Resizing** (`resizePixels(source, width, height, interpolation)`): output pixel i samples
  the source at (i + 0.5) × in / out, so pixel centres line up and nearest neighbour is exact
  at whole-number scales. Shrinking stretches the kernel by the reduction factor, so every
  source pixel counts and a uniform image stays uniform. Taps past the source's edges are
  dropped and the rest renormalised, so edge pixels keep their opacity.
- **Affine transforms** (`transformPixels(source, m, interpolation, clip?)`): `m` maps the
  source's pixel-edge coordinates (pixel (0, 0) spans [0, 1) × [0, 1)) to the output's. The
  output covers the whole-pixel bounds of the transformed corners (`transformedBounds`), cut to
  `clip` if given, and comes with its position. Each output pixel's centre maps back through
  the inverse; a kernel stretches by however much the transform shrinks, and its weights are
  normalised over all its taps, inside the source or not, so outside counts as transparent and
  new edges are anti-aliased. Nearest neighbour breaks ties towards the higher pixel, like
  resizing. `transformMask` does the same for coverage masks (`Selection.transform`).
- **`Affine`** is `[a, b, c, d, e, f]` in canvas `setTransform` order: x′ = a·x + c·y + e,
  y′ = b·x + d·y + f. The y axis points down, so positive angles turn clockwise. `rotation` is
  exact at multiples of 90°; `multiply(outer, inner)` and `aboutPivot` compose transforms, and
  `alignToPixels` shifts one by at most half a pixel so its output starts on a pixel corner,
  which makes quarter turns exact.

## Image Size

`ResampleDocumentCommand(width, height, interpolation)` ("Image Size") scales the document.
Every layer is resampled by the same factors, new width / old width across and new height /
old height down, with its edges rounded to whole pixels (at least one), so layers that met
still meet. Resampling stops at each layer's edges, which stay as opaque as they were. A layer
that would end up larger than 8192 pixels on a side is cut to the canvas first. The selection
is cleared.

## Transforming a layer

`TransformLayerCommand(layerId, affine, interpolation, { label, floating })` maps one layer
through `affine` (canvas coordinates to canvas coordinates), replacing its buffer and offset;
undo puts the old buffer back. If the result would be larger than 8192 pixels on a side, only
the part on the canvas is kept (a transparent canvas-sized layer, if none of it is on the
canvas). Like moving a layer, it isn't a pixel edit and ignores the selection.
`transformLayerCommand` returns null for a missing or hidden layer, the identity or a singular
transform.

- **Rotate Layer** (`rotateLayerCommand(doc, id, degrees, floating)`) turns a layer clockwise
  about the centre of its bounds, bilinear and aligned to pixels; it's null for a whole number
  of turns.
- **A floating selection's layer** transforms with its outline: the selection as lifted, moved
  to where the layer is now, goes through the same transform, so the ants match the pixels.
  The float is marked `edited`, so committing it in place keeps the resampled pixels. The
  outline is cut to the canvas, and if none of it is left the selection becomes null while the
  float stays. Rotate Layer labels this step "Rotate Selection".

## Image menu

Crop to Selection crops to the selection's bounds, keeping the pixels past them. Image Size…
takes a width and height in pixels or percent, with an aspect lock and Nearest neighbour or
Bilinear (the default). Canvas Size… takes a width and height (or the change in each, with
Relative) and a 3 × 3 anchor grid. The ⇄ button between them swaps the width and height, to
turn a landscape canvas portrait or back. With Relative it swaps the sizes the changes give and
works the changes out again: on a 3840 × 2400 canvas, +200 and +100 (4040 × 2500) become −1340
and +1640 (2500 × 4040). The button comes after Height in the Tab order, and a click leaves
the focus where it was, so Enter still resizes. The dialogs remember their settings for the
session. The turns and flips act straight away. Items are disabled when they would do nothing.
There are no shortcuts: Photoshop's use Ctrl+Alt, which is AltGr on many keyboards.

**Rotate Layer…** turns the active layer, or with a selection just the selected pixels, which
it lifts into a floating selection first (as the Move tool would). Its dialog sits at the top
right with no backdrop, and previews **through history**: at most once per animation frame,
it undoes the last rotation and turns the layer afresh from its original pixels (no merge
key), so the canvas, thumbnail and ants show exactly what OK keeps, and resampling never
compounds. OK keeps the lift and the rotation (nothing at all for a whole number of turns);
Cancel undoes both, leaving them on the redo stack, as cancelling a Move drag does. If
something else changes the document meanwhile, the preview leaves history alone.

## Open decisions

- **Memory**: Image Size and transforms keep each layer's old and new buffers whole (for undo
  and redo), as merges do. Beyond the live document that's the old layer while applied and the
  new one once undone: 9 MB and 37 MB for a 1920 × 1200 layer taken to 200 %. Crops and Canvas
  Size copy nothing; deleting cropped pixels keeps only what it cut.
- **Rotate Layer preview** resamples the whole layer each frame on the CPU; a preview on the
  overlay, or a GPU compositor, would be cheaper for very large layers.
- **Repeated transforms** each round to 8 bits and soften the pixels a little: rotating by 15°
  twice isn't quite rotating by 30° once. Keeping the original pixels with the layer (as smart
  objects do) would avoid that.
- **Oversized results** (past 8192 pixels on a side) keep only the part on the canvas.
- **Image Size clears the selection** rather than scaling it.
