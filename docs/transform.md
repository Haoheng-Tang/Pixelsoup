# Cropping, rotation and resampling

How the canvas is cropped, resized, turned and flipped, how layers are resampled, and how Free
Transform moves, scales and turns a layer. The code lives in `src/core/resample`
(interpolation, resizing, affine transforms), `src/core/orientation.ts` (quarter turns and
flips), `src/core/commands` (`canvas-commands.ts`, `orientation-commands.ts`,
`image-size-commands.ts`, `transform-commands.ts`), `src/ui/image-actions.ts` and
`src/ui/panels/ImageMenu.tsx` (the Image menu), `src/ui/dialogs`, `src/ui/transform` (Free
Transform) and `src/ui/render` (`split-compositor.ts` and `canvas-pyramid.ts`, for its
preview). The Crop tool is described with the other tools ([tools.md](tools.md#crop-tool)), as
are Free Transform's handles and keys ([tools.md](tools.md#free-transform)).

## Commands

| Command                   | Factories                                                 | Used by                                             | Kept for undo                       |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| `ResizeCanvasCommand`     | `resizeCanvasCommand`, `cropCommand`, `canvasSizeCommand` | Crop tool, Crop to Selection, Canvas Size…          | no pixels; with `trim`, what it cut |
| `OrientCanvasCommand`     | the constructor                                           | Image → Rotate 90° / 180°, Flip Horizontal/Vertical | no pixels: undo applies the inverse |
| `ResampleDocumentCommand` | `imageSizeCommand`                                        | Image Size…                                         | every layer's old and new pixels    |
| `TransformLayerCommand`   | `transformLayerCommand`                                   | Free Transform, Edit → Transform → Scale, Rotate    | the layer's old and new pixels      |
| `OrientLayerCommand`      | `orientLayerCommand`                                      | Edit → Transform's turns and flips                  | the layer's old and new pixels      |

All are single undo steps, and the factories return null when their command would change
nothing. Each commits a floating selection first (the Crop tool, `runImageAction` and
`AppController` do it, as a step of its own), except the two layer commands on the floating
layer itself, which transform the float instead.

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

`OrientLayerCommand(layerId, orientation, floating)` does the same to one layer, about the
centre of its bounds: `orientPixels` moves its pixels, never resampling them, so two flips give
back the same bytes. A quarter turn of a layer whose width and height differ by an odd number
would land half a pixel off the grid, so it moves on by half a pixel (`alignToPixels`), and the
opposite turn brings it back where it was. Like `TransformLayerCommand` (below), it takes a
floating selection's outline along.

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
  which makes quarter turns exact. A half-pixel shift goes away from the area's own top-left,
  so turning back undoes it.

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

- **Quarter turns and flips aligned to pixels** (`alignToPixels`, as Free Transform aligns
  them) map pixel centres onto pixel centres, so even bilinear interpolation copies them
  exactly.
- **A floating selection's layer** transforms with its outline: the selection as lifted, moved
  to where the layer is now, goes through the same transform, so the ants match the pixels.
  The float is marked `edited`, so committing it in place keeps the resampled pixels. The
  outline is cut to the canvas, and if none of it is left the selection becomes null while the
  float stays.

## Free Transform

Edit → Free Transform (Ctrl/Cmd+Alt+T) and the canvas's context menu move, scale and turn the
active layer, previewed on the overlay, and apply the result as one `TransformLayerCommand`
named "Free Transform". Edit → Transform → Scale and Rotate start the same session limited to
scaling or to turning, named "Scale" and "Rotate"; starting one while a session runs switches
it, keeping the transform so far.

- **What it transforms**: the active layer. With a selection, the selected pixels are lifted
  into a floating selection first, as the Move tool lifts them ("Lift Selection", a step of
  its own), and the float is transformed with its outline; a floating selection is
  transformed as it is. A hidden layer, or a selection that misses the layer, starts nothing,
  and the status bar says why.
- **The session** (`TransformSession`, started by `FreeTransform`) takes over the canvas's
  input from the active tool, which stays active (`ToolManager.startSession`). It keeps the
  layer's pixels and bounds as they were when it began (`TransformSource`), and the transform
  as parameters (`TransformParams`): where the layer's centre, the pivot, goes (x, y), the
  scale along the layer's own axes (negative flips it) and the angle, clockwise. Every change
  rebuilds the `Affine` from them (`transformAffine`: scale and turn about the centre, then
  move it to x, y), so nothing drifts however long a drag lasts. Whole turns and flips at
  100 % are aligned to pixels, so they apply exactly.
- **The preview** leaves the document alone. The composite leaves the layer out
  (`CompositeRenderer.suppress`: `SplitCompositor` composites the layers below it into the
  main image, and those above it onto transparency in a second one). Each frame the overlay
  draws the layer's pixels, put on a canvas once per session, through the view and the
  session's affine at the layer's opacity, then the layers above it, then the box, all clipped
  to the canvas. Smoothing follows the interpolation, except that zoomed out it's always on, as
  the composite's is. Panning and zooming work as usual; the ants hide, and the status bar
  shows the size of the transformed bounds.
- **Shrunk images** are drawn from a `CanvasPyramid`: copies at a half, a quarter, … of the
  size, each made once when first needed. The smallest copy still at least as large as on
  screen is drawn with plain bilinear filtering. Chromium's mipmapped smoothing ('medium')
  would make a mipmapped copy on every draw instead: 35–40 ms a frame for a 6400 × 4000 layer.
- **Applying**: Enter, a double-click inside the box, ✓, or Apply in the context menu. One
  `TransformLayerCommand` with the session's affine and interpolation; a transform that
  changes nothing adds no step and undoes the lift the session began with. A result over
  8192 pixels on a side is refused with a message, and the session goes on.
- **Cancelling**: Escape, ✗ or Cancel in the context menu ends the session and leaves the
  document as it was. A lift the session began with is undone and stays on the redo stack, as
  when a Move drag is cancelled.
- **The pending edit**: while it runs, the session is the editor's `PendingEdit`
  (`Editor.beginPending`). Executing any command applies it first (`EditorHistory.execute`),
  and so do making another layer active, committing a floating selection, choosing a tool,
  Save, Save As and Export (after the file picker), and New, Open, Close, the demo and a
  dropped file (before asking whether to discard changes). Applied that way, a result over
  8192 pixels on a side keeps only the part on the canvas, with a message. Undo cancels the
  session instead (the Edit menu shows "Undo Free Transform"), and Redo is disabled meanwhile.
  It ends without a step if its layer changes, goes away or is hidden all the same, or the
  document is replaced or resized.
- **Edit → Transform's turns and flips** (Flip Horizontal and Vertical, Rotate 180° and 90°
  Clockwise and Anticlockwise) are composed into a running session, about its pivot, as the
  canvas shows it. Without one, each turns or flips the whole active layer straight away with
  `OrientLayerCommand`, one lossless step named after it, even under a selection, which stays
  as it is; a floating selection turns with its outline.
- **The shortcut** is Photopea's, Ctrl/Cmd+Alt+T: Photoshop's Ctrl/Cmd+T opens a new tab
  before a page sees it. Where Option or AltGr makes T type another character (Option+T types
  † on a Mac), the key is matched by its position. Browsers see AltGr as Ctrl+Alt, so AltGr+T
  starts Free Transform on Windows too, but not in a text field. Ubuntu's desktop opens a
  terminal on Ctrl+Alt+T, so use the menu there.

On the development machine (headless Edge, an RTX 2000 Ada laptop GPU), scale and rotate drags
on a 1920 × 1200 photo seen whole run at 60 frames a second (16.7 ms a frame, 0.1 ms of it
script), and so they do on a 6400 × 4000 one (p95 16.9 ms), which ran at about 30 a second
(p95 67 ms) with mipmapped smoothing. With a copy of that layer above it, a frame took 124 ms
before the pyramid and 28 after (turned from the Angle field). A session takes 25 to 40 ms to
show on the smaller photo and about 150 ms on the larger one, and applying a 45° turn 0.34 s
and 3.6 s, resampling on the CPU, on the main thread.

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
There are no shortcuts: Photoshop's use Ctrl+Alt, which is AltGr on many keyboards. Free
Transform's Ctrl/Cmd+Alt+T takes that risk, for want of Ctrl/Cmd+T (above). Turning or flipping
just the active layer is in Edit → Transform.

## Open decisions

- **Memory**: Image Size and transforms keep each layer's old and new buffers whole (for undo
  and redo), as merges do. Beyond the live document that's the old layer while applied and the
  new one once undone: 9 MB and 37 MB for a 1920 × 1200 layer taken to 200 %. Crops and Canvas
  Size copy nothing; deleting cropped pixels keeps only what it cut.
- **Free Transform's preview** is the browser's bilinear filtering (from halved copies when
  shrunk), not the premultiplied resampling that applying does, so the two can differ a
  little, at soft edges especially. Applying resamples on the CPU, on the main thread (3.6 s
  for a 6400 × 4000 layer turned 45°); a worker or the GPU would keep the page responsive.
- **Free Transform's scope**: no skew, distort, perspective or warp, and the pivot stays at
  the layer's centre: the X and Y fields place it, but it can't be dragged elsewhere. The ants
  hide while it runs.
- **Undo during Free Transform** cancels the whole session rather than its last change, and
  Redo is off meanwhile.
- **Edit → Transform's turns and flips** turn the whole layer when no session runs, even under
  a selection; Photoshop's turn just the selected pixels.
- **Repeated transforms** each round to 8 bits and soften the pixels a little: rotating by 15°
  twice isn't quite rotating by 30° once. Keeping the original pixels with the layer (as smart
  objects do) would avoid that.
- **Oversized results** (past 8192 pixels on a side) keep only the part on the canvas, except
  that applying Free Transform itself (Enter, a double-click or ✓) refuses them.
- **Image Size clears the selection** rather than scaling it.
- **Panning huge documents**: below 100 % the composite is drawn with mipmapped smoothing,
  which Chromium redoes on every draw: panning a 6400 × 4000 document seen whole takes 57 ms
  a frame, against 17 with bilinear filtering. Drawing it from a `CanvasPyramid`, as Free
  Transform's preview is, would fix that.
