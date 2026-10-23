# feat: Free Transform's Distort, Skew and Perspective, and projective transforms

## Summary

Build-order step 12 continues: Free Transform gains Photoshop's Distort, Skew and Perspective.
Taking a rectangle to any convex quadrilateral isn't an affine transform, so the core gains
projective matrices (homographies) and projective resampling, and the Free Transform session
now keeps its box as four corners rather than a scale, an angle and a position.

- **Distort** (Ctrl/Cmd+drag a corner): that corner moves on its own. The box stays convex: a
  corner stops a document pixel short of the line through its two neighbours.
- **Skew** (Ctrl/Cmd+drag an edge): the edge slides along itself while the opposite edge stays
  put, or with Alt as well slides the other way.
- **Perspective** (Ctrl/Cmd+Alt+Shift+drag a corner): the corner slides along its edge and
  that edge's other corner moves the same distance the opposite way, so the edge grows or
  shrinks about its middle.
- **Cursors and status bar**: the cursor shows what a press would do, changing as Ctrl, Alt
  and Shift go down and up, and the status bar names Skew, Distort or Perspective.
- **Modes**: during a session the canvas's context menu lists the modes (Free Transform, Scale,
  Rotate, Skew, Distort and Perspective; in each, a plain drag on a handle does that) and
  Reset to Original. Edit → Transform gains Skew, Distort and Perspective, which start a
  session in that mode.
- **Options bar**: H and V skew fields, in degrees. While the box isn't a parallelogram, W and
  H show its bounding box, and the angle and skews are blank and disabled.
- **Preview**: Canvas 2D can't draw a homography, so a distorted box is drawn as a mesh of
  affine triangles, from 8 × 8 to 32 × 32 cells depending on how far it is from a
  parallelogram. Parallelograms keep the single `drawImage`, and applying always resamples
  with the exact transform.
- **Affine results unchanged**: `transformPixels` and `transformMask` take a `Projective`, but
  a matrix that is affine goes through the existing sampler, so its bytes are bit-identical
  to `main`'s.

Scale, rotate, move, nudge, the fields, the flips and turns, Esc, Enter and undo behave as
before ([Parity with main](#parity-with-main)), and a transform that changes nothing still adds
no step. A floating selection distorts with its outline, the ants matching the pixels exactly.
No new dependencies, and the `.soup` format is unchanged.

## What's included

Commits are meant to be reviewed one at a time:

1. **Projective transforms and homography fitting** (`src/core/resample/projective.ts`):
   - `Projective`, a 3 × 3 matrix row by row, with `fromAffine`, `toAffine`, `isAffine` (a
     bottom row of (0, 0, 1) to within 10⁻¹²), `multiplyProjective`, `invertProjective` and
     `projectPoint` (with the perspective divide). `compose`, `mapPoint`, `mapCorners` and
     `mappedBounds` take either kind of matrix; `mappedBounds` is null for an area reaching
     past the horizon.
   - `homographyFromQuad(rect, quad)` solves the 8 × 8 system taking the rectangle's corners
     to the quad's (Gaussian elimination with partial pivoting, on the unit square and the
     quad scaled to about a unit across, which keeps it well conditioned). A parallelogram
     gives an exactly affine matrix. Quads that fail `isConvexQuad` (concave, crossed, or
     with three corners in line) give null.
   - `affine.ts` shares its whole-pixel rounding as `wholePixelBounds`.
2. **Projective resampling for layers and selections** (`transform.ts`,
   `transform-commands.ts`, `selection.ts`):
   - A matrix that `isAffine` takes the existing affine sampler, so its bytes don't change.
     Otherwise each output pixel's centre maps back with the perspective divide, bilinear (or
     nearest) in premultiplied alpha as before.
   - The hot loop steps the homogeneous coordinates along each row (three additions and a
     division a pixel, nothing allocated), restarting every 64 output columns, so a pixel's
     sample point depends only on where it is: clipped output matches the uncut result, and a
     floating selection's mask lines up with its pixels.
   - The kernel stretches per pixel by how much the transform shrinks there (from the
     inverse's derivatives), so the far side of a perspective is filtered, not aliased.
   - `TransformLayerCommand` and `Selection.transform` take either kind of matrix. A transform
     that takes part of the layer past its horizon gives null.
3. **Free Transform as a quad of corners** (`transform-math.ts`, `transform-session.ts`,
   `tool.ts`, `selection-overlay.ts`), changing no behaviour:
   - `TransformState` is where the layer's four corners go, where its centre goes (the pivot),
     and an angle, which tells a layer flipped left to right from one flipped upside down and
     turned half round, whose corners are the same.
   - `scaleState`, `rotateState`, `moveState` and `orientState` rebuild the corners from the
     state at the press every frame, never adding up changes. `stateFromParams` and
     `stateParams` convert to and from the old parameters.
   - `stateMatrix` fits the transform to the corners: an `Affine` while they make a
     parallelogram (to within 10⁻⁶ px), so whole turns and flips still align to pixels and
     copy them exactly, and a homography otherwise (which nothing makes yet in this commit).
   - The options bar reads its fields through `stateParams`, hit-testing and cursors work
     from the box's corners, and the overlay carries a matrix that may be projective.
   - Every existing test assertion keeps its expected value. The tests call the functions by
     their new names (`scaleParams` → `scaleState`, …) and read results back through the
     corners; the session tests change only for renames (`affine` → `matrix`, `multiply` →
     `compose`).
4. **Distort, skew and perspective** (`transform-math.ts`, `transform-session.ts`,
   `transform-cursors.ts`, `TransformOptionsPanel.tsx`, `EditMenu.tsx`, `free-transform.ts`,
   `StatusBar.tsx`):
   - `distortState`, `skewState` and `perspectiveState`, within the convexity limits: a corner
     comes no closer than a document pixel to the line through its two neighbours (no closer
     than it was, if it started closer), nor goes round past the lines through the edges
     beyond them. A distorted corner stops at the nearest point that keeps to that, so it
     slides along the limit; a skew or a perspective stops short.
   - `hitTransform` turns Ctrl/Cmd on a corner into distort, on an edge into skew, and
     Ctrl/Cmd+Alt+Shift on a corner into perspective, in every mode. `TransformMode` gains
     `skew`, `distort` and `perspective`, whose plain handle drags do that.
   - Cursors (`transform-cursors.ts`): a white arrowhead with a badge, a lopsided
     quadrilateral to distort and a trapezoid for perspective, and a double arrow along the
     edge to skew.
   - A box in perspective stays in perspective as it scales, and a handle stops just short of
     the layer's horizon rather than flipping it through infinity.
   - The context menu's modes and Reset to Original (disabled while nothing has changed), and
     Edit → Transform → Skew, Distort and Perspective. A status message repeated while it
     shows now stays rather than flickering.
   - The H and V skew fields: the degrees the left and right edges, or the top and bottom
     ones, lean clockwise, about the pivot. Skews of 90° or more, and ones that would fold the
     box or make it too large, are refused.
   - Until the next commit, a distorted box previews only its outline.
5. **Mesh preview** (`projective-mesh.ts`, `selection-overlay.ts`, `canvas-pyramid.ts`):
   - `PreviewMesh` cuts the part of the layer in view (`visibleArea`) into n × n cells, two
     triangles each, and fills each triangle with the image through the affine that takes its
     corners exactly where the homography does, clipped to itself. n, from 8 to 32
     (`meshCells`), grows with how far the quad on screen is from a parallelogram.
   - Grid lines are spaced evenly in 1/√w, w being the homography's divisor, rather than
     evenly over the image, so cells are smaller where the layer is magnified. Each triangle
     draws from the pyramid level for its own scale (`CanvasPyramid.level()`) and reaches half
     a device pixel past its edges, miters limited, so no seams show. A translucent layer is
     drawn opaque on a scratch canvas, then at its opacity, so the overlaps don't show as
     darker lines.
6. **Docs**: `docs/transform.md` gains projective matrices, quad fitting and projective
   resampling, the quad model of the session, the mesh preview with its error and timings,
   and new open decisions; `docs/tools.md` the keys, modes, cursors, convexity limits and
   skew fields; the README its features and shortcuts table. CLAUDE.md marks the new
   transforms done and stays at 199 lines.
7. **Options bar in narrow windows** (`TransformOptionsPanel.tsx`, `styles.css`): the skew
   fields pushed ✓ and ✗ past the window's edge below about 1390 px, on 1280 and 1366 px
   laptop screens among others. Below 1400 px the fields now sit 8 px apart rather than 16
   and the Interpolation label is left out (the select keeps the name as its accessible name
   and tooltip), so ✓ and ✗ stay in view down to about 1260 px. Wider windows are laid out as
   before.

## Design notes

- **Corners, not parameters**: a distorted box has no scale or angle, so the session keeps the
  corners and derives the old parameters only while the box is a parallelogram. Every drag
  rebuilds the corners from the press, so nothing drifts, however long it lasts.
- **Affine wherever possible**: the session fits an `Affine` to a parallelogram, and the core
  sends any affine matrix down the old sampler. Scale, rotate, move and the fields preview
  and apply through the same paths as on `main`; the projective code runs only for a box
  that isn't a parallelogram.
- **Convex boxes only**: no homography takes a rectangle onto a concave or crossed quad with
  the inside kept inside, so the interactions keep the box convex with a pixel to spare, and
  `homographyFromQuad` refuses such quads as a backstop.
- **One sample point per output pixel**: restarting the incremental coordinates on a fixed
  64-column grid makes a clipped output, and a floating selection's mask, sample exactly
  where the whole output would. That's why the ants match the distorted pixels exactly.
- **A mesh, not WebGL**: the preview stays on the existing Canvas 2D overlay. Spacing the grid
  in 1/√w brought the worst error for a 6400 × 4000 photo with its top edge narrowed to a
  fifth, seen whole, from 6.3 to 0.8 device px. Meshing only what's in view keeps it within a
  third of a device pixel at 400 %, where a mesh of the whole layer would stray 8.9 px. A
  WebGL preview could draw the homography exactly; that's left for later.
- **Photoshop's keys, and modes for plain drags**: Ctrl/Cmd distorts and skews in every mode,
  and the modes make plain drags do the same without holding keys, as in Photoshop.

### Parity with main

- The refactor kept every test's expected values, and a script replaying the same sessions on
  `main` and on this branch in headless Edge saw the same box, fields, labels, Esc and Enter
  outcomes and undo steps every time.
- Pixels, from 1500 random single-operation sessions on a 257 × 193 noise image, applied on
  both:
  - **Byte-identical**: moves, nudges, flips and turns, and the X and Y fields. Free rotations
    and the Angle field give matrices that differ from `main`'s only in the last bit, and
    identical pixels.
  - **One level apart, here and there**: 107 of 486 scale drags differ, in 10,599 of about
    107 million bytes; 23 of 95 snapped rotations, in 52 bytes; 3 of 112 W and H field edits.
    No byte differs by more than one level.
  - **Why**: fitting the matrix to the corners is mathematically equal to `main`'s product of
    a translation, rotation, scale and translation, but can differ in the last bit, which
    tips samples landing exactly on a rounding tie (common with the rational scale factors a
    handle snapped to whole pixels gives). Exact parity would mean carrying `main`'s
    parameters alongside the corners, a hybrid this design avoids.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 1094 tests across 83 files (88 new, in 2 new files and 5 existing ones)
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover (new files: `projective`, `projective-mesh`):

- **Homography** (`projective.test.ts`): the source rect itself gives the identity; a
  parallelogram gives an affine matrix whose bottom row is exactly (0, 0, 1); the four corners
  map exactly, a mirrored quad and a big one included; points inside map consistently with
  the inverse; the centre goes where the diagonals cross; straight lines stay straight;
  degenerate quads and empty sources are refused, as `isConvexQuad` refuses concave, crossed
  and flattened ones. Also the matrix arithmetic, `fromAffine` and `toAffine` round trips,
  inversion (exactly `invert`'s for affine matrices), and bounds, null past the horizon.
- **Pixels** (`transform.test.ts`): a matrix that is affine gives exactly the affine path's
  bytes; a rectangle taken to a trapezoid keeps straight lines straight (sampled along an
  edge); a checkerboard's columns converge and further rows shrink; edges against
  transparency are anti-aliased without darkening; nearest neighbour; any nonzero multiple of
  the matrix is the same transform; a clipped output matches the uncut one; crossing the
  horizon gives null; masks map as alpha does.
- **Commands** (`transform-commands.test.ts`): a perspective maps a layer and undoes to the
  very same pixels; one reaching past the horizon is refused; a floating selection's outline
  distorts with its pixels.
- **Session math** (`transform-math.test.ts`): the ported scale, rotate, move and orient tests;
  the matrix and the old parameters reading back the same; a projective fit; scaling in
  perspective, stopping short of the horizon; Ctrl/Cmd hits in every mode and the modes'
  plain hits; the new cursors; the skew fields reading back the same, scaled, turned and
  flipped, and refusing bad values; the bounding-box fields while distorted; `skewState`,
  `distortState` (one corner on its own, the convexity limits, an edge's two corners together)
  and `perspectiveState` (the pair moving symmetrically, stopping before the edge shrinks to
  a point).
- **Sessions** through the `ToolManager` with `FakeViewport` (`transform-session.test.ts`):
  Ctrl-dragging one corner and applying a projective transform; the convexity limit;
  Ctrl-dragging an edge, with and without Alt; Ctrl+Alt+Shift perspective; cursors following
  the keys; Escape mid-drag, then again to cancel; a distortion dragged back adding no step;
  plain drags in each mode; modes started from the Edit menu, named after them; Reset to
  Original then Enter adding no step; a floating selection distorted with its outline; the
  context menu's items.
- **Mesh** (`projective-mesh.test.ts`): cell counts; two triangles a cell with their corners
  exactly on the homography; even spacing for an affine transform and 1/√w spacing otherwise;
  the half-pixel overlap and its limit at sharp corners; triangles out of view or with no area
  left out; `visibleArea`; and accuracy, for a 6400 × 4000 image with its top edge narrowed to
  a fifth: within a device pixel seen whole, and within half a device pixel at 400 %, meshing
  only what shows.

These checks were run with scripts driving headless Microsoft Edge through the DevTools
protocol, with real pointer and key events, against `npm run preview` (the same `dist/`
Cloudflare serves) rather than the Cloudflare preview, which needs the branch pushed. On a
1464 × 2022 photo at a device scale of 1.25, everything passed:

- **Cursors**: a plain corner showed the resize arrow; Ctrl on a corner the distort cursor and
  "Distort" in the status bar; Ctrl+Alt+Shift on a corner "Perspective"; Ctrl on an edge
  "Skew".
- **Distort**: Ctrl-dragging the top corners in and down moved one corner each time, and W and
  H showed the bounding box (100 % and 88 %) with the angle and skews disabled. Dragging the
  bottom-left corner across the line through its neighbours stopped it a document pixel
  short; Escape mid-drag put it back, and the session went on.
- **Apply, at 400 %**: along 1763 rows, the left and right edges' 50 % alpha crossings lay
  within 0.05 px RMS (0.1 px at most) of the ideal straight lines, and the top edge sat a
  constant 0.07 px off. The edge pixels were no darker than those just inside (mean luminance
  143.8 against 141.5): no dark fringe.
- **Skew**: Ctrl-dragging the right edge down 300 px gave a V skew of 11.58° (atan 300/1464),
  the left edge fixed; Ctrl-dragging the bottom edge then slid both its corners along that
  tilted edge (H skew −5.32°). Applied as one step.
- **Perspective**: Ctrl+Alt+Shift-dragging the top-left corner 400 px right moved the
  top-right one 400 px left, and the bottom-left 200 px left moved the bottom-right 200 px
  right. Applied as one step.
- **Context menu**: the six modes (the current one ticked), the flips and turns, Reset to
  Original, Apply and Cancel. Each mode made a plain drag do that, and the options bar's name
  followed. Reset put the box back, and Enter then added no step, keeping the redo stack.
- **Floating selection**: a marquee selection, distorted and put in perspective, then applied:
  the float stayed edited and active, and its alpha matched the selection's coverage in all
  236,133 pixels.
- **Options bar**: in a 1280 px window ✓ and ✗ ended at 1253 px, in view. Typing 30 in Angle
  and −12.5 in V and clicking ✓ applied one "Free Transform" step; ✗ cancelled with no change.
- **Parity with main**: the replay and pixel comparison [above](#parity-with-main).
- **Frame times** (headless Edge, an RTX 2000 Ada laptop GPU, a 2185 × 1168 device-pixel
  overlay): on a 6400 × 4000 photo the mesh has at most 2048 triangles and takes about 3 ms a
  frame to build and draw (p95 5–6 ms), and a perspective drag seen whole ran at 60 frames a
  second. Pans and zooms keep the affine preview's frame rate at every zoom. Applying a strong
  perspective took 2.9–3.9 s. The mesh's worst error against the exact transform, in device
  pixels, anywhere in the view:

  | Box                                         | Seen whole (22 %) | 100 % | 400 % |
  | ------------------------------------------- | ----------------- | ----- | ----- |
  | Top edge narrowed to a fifth                | 0.80              | 0.52  | 0.25  |
  | Top edge narrowed to a twentieth            | 1.25              | 0.96  | 0.30  |
  | Bottom-right corner pulled in to 4000, 2600 | 0.76              | 0.63  | 0.27  |
  | Perspective both ways (no edge parallel)    | 0.48              | 0.32  | 0.26  |

In the browser (on the Cloudflare preview once pushed):

- [ ] Open a photo, press Ctrl+Alt+T (Cmd+Option+T), Ctrl/Cmd-drag a corner into a strong
      perspective and press Enter. At 400 % the edges are straight, with no dark fringe.
- [ ] Ctrl/Cmd-drag an edge to skew it, then again with Alt.
- [ ] Ctrl/Cmd+Alt+Shift-drag a corner: it and its neighbour move apart or together.
- [ ] Try to fold the box over by distorting a corner: it stops short.
- [ ] Right-click during a session, choose Distort and drag a corner with no keys held; then
      Reset to Original.
- [ ] Scale and rotate as before. Esc leaves nothing in Edit → Undo; Enter adds one step.
- [ ] Make a selection, press Ctrl+Alt+T, distort it and apply: the ants follow the pixels.
- [ ] In a window about 1280 px wide, ✓ and ✗ stay in view.

## Known limitations

- **The preview approximates a distorted box**: where the mesh's triangles meet, straight
  lines bend very slightly (by up to 1.25 device px in the cases above, less zoomed in), and
  neighbouring triangles may draw from different pyramid levels, one a little softer. Like
  the affine preview, it's the browser's bilinear filtering. Applying always resamples with
  the exact transform.
- **Applying runs on the CPU, on the main thread**: 2.9–3.9 s for a strong perspective on a
  6400 × 4000 layer, about what a 45° turn already took.
- **A distorted box's fields**: W and H show its bounding box and scale that on the canvas's
  axes, without flipping; the angle and skews stay blank until the box is a parallelogram
  again (Reset to Original, for one).
- **Convex boxes only**: Distort, Skew and Perspective stop a pixel short of folding the box
  over, since no homography could take the layer there.
- **Undo** still cancels the whole session rather than its last change.
- **Options bar**: below about 1260 px wide, ✓ and ✗ still go past the window's edge, where
  `main`'s fit down to about 1150 px. Enter and Esc work at any width.
- **Bundle size**: the main chunk grows from 491.6 to 513.5 kB (164 kB gzipped) and now trips
  Vite's 500 kB advisory warning; the build still passes. Code-splitting or raising
  `chunkSizeWarningLimit` would quiet it.
- **A timing test can fail on a busy machine**: `flood-region.test.ts`'s "2000 × 2000 pixels
  well within a second" took 1.09 and 1.18 s on `main` too while other work ran, and passes
  on an idle machine.
- **Not tried here**: the Cloudflare preview, a Mac (Cmd is covered by unit tests only),
  Firefox and Safari, touch and pens.

## Deliberately out of scope

- Warp, a draggable pivot and reference-point presets.
- A WebGL preview that draws the homography exactly, and a worker or GPU resampler for
  applying.
- Perspective crop, and transforming several layers at once.
