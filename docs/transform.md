# Cropping, rotation and resampling

How the canvas is cropped, resized, turned and flipped, how layers are resampled, and how Free
Transform moves, scales, turns, skews and distorts a layer, or puts it in perspective. The
code lives in `src/core/resample` (interpolation, resizing, affine and projective
transforms), `src/core/orientation.ts` (quarter turns and flips), `src/core/commands`
(`canvas-commands.ts`, `orientation-commands.ts`, `image-size-commands.ts`,
`transform-commands.ts`), `src/ui/image-actions.ts` and `src/ui/panels/ImageMenu.tsx` (the
Image menu), `src/ui/dialogs`, `src/ui/transform` (Free Transform) and `src/ui/render`
(`split-compositor.ts`, `canvas-pyramid.ts` and `projective-mesh.ts`, for its preview). The
Crop tool is described with the other tools ([tools.md](tools.md#crop-tool)), as are Free
Transform's handles and keys ([tools.md](tools.md#free-transform)).

## Commands

| Command                   | Factories                                                 | Used by                                             | Kept for undo                       |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| `ResizeCanvasCommand`     | `resizeCanvasCommand`, `cropCommand`, `canvasSizeCommand` | Crop tool, Crop to Selection, Canvas Size…          | no pixels; with `trim`, what it cut |
| `OrientCanvasCommand`     | the constructor                                           | Image → Rotate 90° / 180°, Flip Horizontal/Vertical | no pixels: undo applies the inverse |
| `ResampleDocumentCommand` | `imageSizeCommand`                                        | Image Size…                                         | every layer's old and new pixels    |
| `TransformLayerCommand`   | `transformLayerCommand`                                   | Free Transform, Edit → Transform's modes            | the layer's old and new pixels      |
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
- **`Projective`** (`projective.ts`) is a 3 × 3 matrix, row by row: x′ = (m0·x + m1·y + m2) / w
  and y′ = (m3·x + m4·y + m5) / w, with w = m6·x + m7·y + m8. Lines stay straight but parallel
  lines may meet, so a rectangle can go to any convex quadrilateral. `fromAffine` and
  `toAffine` convert, `isAffine` checks for a bottom row of (0, 0, 1) to within 10⁻¹², and
  `multiplyProjective`, `invertProjective` and `projectPoint` (with the perspective divide) do
  the arithmetic.
- **Fitting a quad**: `homographyFromQuad(rect, quad)` is the matrix taking the rectangle's
  top-left, top-right, bottom-right and bottom-left corners to the quad's four points. It
  solves the usual 8 × 8 linear system (Gaussian elimination, partial pivoting) for the unit
  square and the quad scaled to about a unit across, which keeps the system well conditioned.
  A parallelogram gives an exactly affine matrix. A quad that isn't convex (`isConvexQuad`:
  bent inwards, crossed, or with three corners in line) gives null, since no transform takes
  the rectangle onto it with the inside kept inside; callers keep their quads convex.
- **Projective transforms**: `transformPixels` and `transformMask` take either kind of
  matrix. One that `isAffine` goes the affine way, giving exactly the bytes its `Affine`
  gives. Otherwise each output pixel's centre goes back through the inverse with the
  perspective divide, its homogeneous coordinates stepping along the row: three additions and
  a division a pixel, with nothing allocated. They restart every 64 pixels, so a clipped
  output, or a selection's mask, samples exactly where the whole output would. The kernel
  stretches by how much the transform shrinks at that pixel (from the inverse's derivatives
  there), so the far side of a perspective anti-aliases as a shrink does, and filtering keeps
  the premultiplied rule. The output covers the whole-pixel bounds of the mapped corners
  (`mappedBounds`). A matrix that takes part of the source past its horizon (where w changes
  sign), out to infinity, gives null.

## Image Size

`ResampleDocumentCommand(width, height, interpolation)` ("Image Size") scales the document.
Every layer is resampled by the same factors, new width / old width across and new height /
old height down, with its edges rounded to whole pixels (at least one), so layers that met
still meet. Resampling stops at each layer's edges, which stay as opaque as they were. A layer
that would end up larger than 8192 pixels on a side is cut to the canvas first. The selection
is cleared.

## Transforming a layer

`TransformLayerCommand(layerId, matrix, interpolation, { label, floating })` maps one layer
through `matrix`, an `Affine` or a `Projective` (canvas coordinates to canvas coordinates),
replacing its buffer and offset; undo puts the old buffer back. If the result would be larger
than 8192 pixels on a side, only the part on the canvas is kept (a transparent canvas-sized
layer, if none of it is on the canvas). Like moving a layer, it isn't a pixel edit and ignores
the selection. `transformLayerCommand` returns null for a missing or hidden layer, the
identity, a singular matrix, or one that takes part of the layer past its horizon.

- **Quarter turns and flips aligned to pixels** (`alignToPixels`, as Free Transform aligns
  them) map pixel centres onto pixel centres, so even bilinear interpolation copies them
  exactly.
- **A floating selection's layer** transforms with its outline: the selection as lifted, moved
  to where the layer is now, goes through the same matrix, affine or projective, sampled at
  the same points, so the ants match the pixels.
  The float is marked `edited`, so committing it in place keeps the resampled pixels. The
  outline is cut to the canvas, and if none of it is left the selection becomes null while the
  float stays.

## Free Transform

Edit → Free Transform (Ctrl/Cmd+Alt+T) and the canvas's context menu transform the active
layer: move, scale, turn, skew or distort it, or put it in perspective. It's previewed on the
overlay, and the result is applied as one `TransformLayerCommand` named "Free Transform". Edit
→ Transform → Scale, Rotate, Skew, Distort and Perspective start the same session in a mode,
named after it, that changes what a plain drag on a handle does
([tools.md](tools.md#free-transform)). The context menu switches modes, as does starting one
while a session runs, keeping the transform so far.

- **What it transforms**: the active layer. With a selection, the selected pixels are lifted
  into a floating selection first, as the Move tool lifts them ("Lift Selection", a step of
  its own), and the float is transformed with its outline; a floating selection is
  transformed as it is. A hidden layer, or a selection that misses the layer, starts nothing,
  and the status bar says why.
- **The session** (`TransformSession`, started by `FreeTransform`) takes over the canvas's
  input from the active tool, which stays active (`ToolManager.startSession`). It keeps the
  layer's pixels and bounds as they were when it began (`TransformSource`), and the transform
  as a quad (`TransformState`): where the corners of the layer's bounds go (the box: its
  top-left, top-right, bottom-right and bottom-left as they are on the layer), where its
  centre goes (the pivot), and an angle, which tells a layer flipped left to right from one
  flipped upside down and turned half round, whose corners are the same.
- **Every change moves the corners**, rebuilt each frame from the state at the press and where
  the pointer is, never added up frame by frame, so nothing drifts however long a drag lasts.
  A move translates them, a turn turns them about the pivot, and the menu's turns and flips map
  them about it. A scale scales the layer before the box's transform, so a box in perspective
  stays in perspective. Skew, Distort and Perspective move one, two or four corners, and stop
  where the box would stop being convex ([tools.md](tools.md#free-transform)).
- **Fitting**: the transform previewed and applied is the one taking the layer's bounds to the
  box (`stateMatrix`). While the box is a parallelogram (to within 10⁻⁶ pixels) that's an
  `Affine`, and whole turns and flips at 100 % are aligned to pixels, so they apply exactly.
  Otherwise it's a homography (`homographyFromQuad`). The options bar reads a parallelogram
  as a scale, a skew and a turn about the layer's centre, and where that centre goes
  (`stateParams`). A box that isn't one has no size along the layer's axes, so W and H show
  its bounding box's, and the angle and skews are blank.
- **The preview** leaves the document alone. The composite leaves the layer out
  (`CompositeRenderer.suppress`: `SplitCompositor` composites the layers below it into the
  main image, and those above it onto transparency in a second one). Each frame the overlay
  draws the layer's pixels, put on a canvas once per session, through the view and the
  session's transform at the layer's opacity, then the layers above it, then the box, all
  clipped to the canvas. Smoothing follows the interpolation, except that zoomed out it's
  always on, as the composite's is. Panning and zooming work as usual; the ants hide, and the
  status bar shows the size of the transformed bounds.
- **Shrunk images** are drawn from a `CanvasPyramid`: copies at a half, a quarter, … of the
  size, each made once when first needed. The smallest copy still at least as large as on
  screen is drawn with plain bilinear filtering. Chromium's mipmapped smoothing ('medium')
  would make a mipmapped copy on every draw instead: 35–40 ms a frame for a 6400 × 4000 layer.
- **A distorted box**: a canvas draws images only through affine transforms, so while the box
  isn't a parallelogram the layer is drawn as a mesh of triangles (`PreviewMesh`,
  `projective-mesh.ts`) rather than with one `drawImage`. The part of the layer in view
  (`visibleArea`: the box on screen clipped to the overlay, mapped back to whole layer pixels)
  is cut into n × n cells, two triangles each. Each triangle is filled with the image through
  the affine that takes its three corners where the homography takes them, clipped to itself.
  n, from 8 to 32 (`meshCells`), grows with how far the box on screen is from a parallelogram:
  how far its diagonals' crossing is from their midpoints, in device pixels.
- **The mesh's grid** is evenly spaced in 1/√w, with w the homography's divisor along the
  edge where it's smaller, rather than evenly over the layer. That makes the cells smaller
  where the layer is magnified, where a triangle strays furthest from the homography, and
  keeps the error about the same all over. Each triangle is a pattern fill of the pyramid
  level for its own scale, so a perspective's far side comes from a smaller copy, and reaches
  half a device pixel past its edges (miters limited to 4), so no seams let the checkerboard
  through. A translucent layer's mesh is drawn opaque on a scratch canvas, which is then drawn
  at the layer's opacity, so the overlaps don't show as darker lines.
- **The mesh is an approximation**: straight lines across the layer bend very slightly where
  triangles meet. The table gives the most the triangles stray from the exact transform, in
  device pixels, for a 6400 × 4000 layer on a 2185 × 1168 device-pixel overlay (a 125 %
  display), over the whole view, with the view centred anywhere on the layer when zoomed in.
  Applying always resamples with the exact transform.

  | Box                                         | Seen whole (22 %) | 100 % | 400 % |
  | ------------------------------------------- | ----------------- | ----- | ----- |
  | Top edge narrowed to a fifth                | 0.80              | 0.52  | 0.25  |
  | Top edge narrowed to a twentieth            | 1.25              | 0.96  | 0.30  |
  | Bottom-right corner pulled in to 4000, 2600 | 0.76              | 0.63  | 0.27  |
  | Perspective both ways (no edge parallel)    | 0.48              | 0.32  | 0.26  |

- **Applying**: Enter, a double-click inside the box, ✓, or Apply in the context menu. One
  `TransformLayerCommand` with the session's matrix (an `Affine` for a parallelogram, else a
  `Projective`) and interpolation; a transform that changes nothing adds no step and undoes
  the lift the session began with. A result over 8192 pixels on a side is refused with a
  message, and the session goes on.
- **Cancelling**: Escape, ✗ or Cancel in the context menu ends the session and leaves the
  document as it was. A lift the session began with is undone and stays on the redo stack, as
  when a Move drag is cancelled.
- **The pending edit**: while it runs, the session is the editor's `PendingEdit`
  (`Editor.beginPending`). Executing any command applies it first (`EditorHistory.execute`),
  and so do making another layer active, committing a floating selection, choosing a tool,
  Save, Save As and Export (after the file picker), and New, Open, Close, the demo and a
  dropped file (before asking whether to discard changes). Applied that way, a result over
  8192 pixels on a side keeps only the part on the canvas, with a message. Undo cancels the
  session instead (the Edit menu shows "Undo Free Transform", or the mode's name), and Redo is
  disabled meanwhile. It ends without a step if its layer changes, goes away or is hidden all
  the same, or the document is replaced or resized.
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

Distorted, the larger photo's mesh has up to 2048 triangles, which take about 3 ms a frame to
build and draw (p95 5 to 6 ms), and a perspective drag seen whole ran at 60 frames a second. The
GPU spends about 5 µs a triangle: on battery, where Edge drew 40 frames a second, its process
was busy 655 ms a second against 219 for an affine box seen whole, 534 against 222 at 100 %,
and the same at 400 %, where fewer triangles show. Pans and zooms keep the affine preview's
frame rate at every zoom (seen whole, both take 50 to 60 ms a frame on battery, for the
composite: see "Panning huge documents" below). Applying a strong perspective took 2.9 to
3.9 s.

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
  little, at soft edges especially. A distorted box's mesh also bends lines very slightly
  where its triangles meet (by up to 1.25 device pixels in the cases above, less zoomed in),
  and neighbouring triangles may come from different pyramid levels, one a little softer. Applying resamples
  on the CPU, on the main thread (3.6 s for a 6400 × 4000 layer turned 45°); a worker or the
  GPU would keep the page responsive. A WebGL preview could draw the homography exactly.
- **Free Transform's scope**: no warp, and the pivot stays at the layer's centre: the X and Y
  fields place it, but it can't be dragged elsewhere. The ants hide while it runs.
- **Convex boxes only**: Distort, Skew and Perspective stop a pixel short of the box folding
  over, since no homography takes a rectangle onto a concave or crossed quad.
- **A distorted box's fields**: W and H show its bounding box, and setting them scales that
  box on the canvas's axes, without flipping; the angle and skews stay blank until the box is
  a parallelogram again (Reset to Original, for one).
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
