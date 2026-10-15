# CLAUDE.md

Guidance for AI assistants and contributors working on Pixelsoup, an open-source layered
raster image editor (a lightweight Photoshop) that runs entirely in the browser.

## Git workflow

- `main` must always lint, test, and build. Never commit directly to `main`.
- All work happens on `feat/*`, `fix/*`, or `chore/*` branches, landing on `main` via pull request.
- Make small, logical commits that are easy to review (e.g. tooling, model, compositor + tests,
  UI piece, docs). Don't mix refactors with features.
- Don't push or merge unless explicitly asked.
- Before declaring work done: `npm run lint`, `npm test`, `npm run build` must all pass, and UI
  changes must be checked in a browser (`npm run dev`).

## Stack

| Concern         | Choice                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| Language        | TypeScript, `strict` plus `exactOptionalPropertyTypes` and friends                 |
| Build / dev     | Vite **7** (see the no-Rust constraint)                                            |
| UI panels       | React 19 (toolbar, layer list, options)                                            |
| Canvas          | Imperative HTML5 Canvas 2D viewport; no React on the hot path                      |
| Compositing     | CPU compositor in `src/core` behind an interface that a WebGL/WebGPU one can match |
| Tests           | Vitest (Node environment; `src/core` is tested without a DOM)                      |
| Lint / format   | ESLint (typescript-eslint, type-checked) + Prettier                                |
| Package manager | npm                                                                                |
| Platform        | Pure web app, no desktop shell (see "Decisions")                                   |

Keep dependencies minimal. **Ask before adding any library** beyond the stack above.

### No-Rust constraint

- No Rust toolchain may be required to develop or build the project (no Rust source, no Tauri).
- Prebuilt npm binaries are fine if AppLocker allows them. A standalone `.exe` needs an allow rule
  (esbuild has a hash rule); native `.node` addons such as Rollup's load normally.
- Prefer a pure-JS alternative when one exists.

**Colors:** 8-bit sRGB only, straight (non-premultiplied) alpha. No color management, ICC
profiles, high bit depth or linear-light blending. Blend directly on sRGB-encoded values.

## Architecture rules

- **`src/core/`** holds pure document and pixel logic. Zero DOM, React, Node, or shell API
  imports; fully unit-testable. This is enforced twice: `tsconfig.core.json` compiles core
  without the DOM lib or any `@types`, and ESLint restricts its imports.
- **`src/ui/`** holds React panels plus the imperative canvas viewport. It may import core, never
  the other way round. Browser code must not use Node or shell APIs (lint-enforced).
- **Document model**: `ImageDocument` (not `Document`, the DOM global) has `width`, `height`, an
  ordered layer stack (`layers[0]` is the bottom) and a `selection` slot.
- **Layers** are a discriminated union on `kind`. Today only `RasterLayer` exists: its own
  `PixelBuffer` (RGBA8, sRGB, straight alpha), an offset `x`/`y` (may be negative or extend past
  the canvas), `opacity` (0–1), `visible`, and `blendMode`. Text and adjustment layers are added
  as new union members (shared properties live in `LayerBase`); every `switch (layer.kind)` ends
  in `assertNever` so the compiler points to each place that needs updating.
- **Selection** is an immutable coverage mask the size of the canvas (`Selection`, 0–255).
  `doc.selection` is `null` for "no selection" (everything editable), never empty, and set by
  `SetSelectionCommand` (undoable; not an unsaved change). Moves and transforms carry or clear it.
  **Invariant: every pixel edit clips to a non-null `doc.selection`, weighting by coverage / 255.**
- **Undo/redo is command-based.** Every document mutation is a `Command` (`apply` / `revert`,
  returning a `DocumentChange` with dirty rects) run through `editor.history.execute(cmd)`;
  nothing else may mutate an `ImageDocument`. Gestures share a `mergeKey`: one gesture, one step.
- **Pixel edits** save just the pixels they change before their first write (`PixelSnapshot`
  rects; strokes: 64 px tiles), and revert restores them. They list the layer in `layerPixels`.
  A floating selection (`editor.floating`, session state) is committed before its source changes.
- **`Editor`** owns one document plus its history and broadcasts each `DocumentChange` to
  subscribers (the viewport and panels). It tracks the save point (`isDirty`, `markSaved`);
  `replaceDocument` swaps in a new or opened document and resets history.
- **Active layer**: `editor.activeLayerId` is session state, as in Photoshop: never part of the
  document, never saved, never a history step. It always names an existing layer (null only
  with no layers); `Editor` fixes it up after each change. Layer commands, panel: @docs/layers.md
- **Files**: core reads and writes `.soup` bytes through an injected `PngCodec`; decoding
  images lives in `src/ui/io`. **`FileStore`** (`src/ui/io/file-store.ts`) alone knows how files
  are picked, dropped and written (File System Access API, else file input and downloads).
  Pickers need user activation, so file commands start synchronously in the click or key press.
  `DocumentSession` runs file operations; `AppController` runs File commands, drops and dialogs.
- **Compositor**: `Compositor.composite(doc, dirtyRects?)` flattens visible layers (Normal blend
  × layer opacity) into its own output, touching only the dirty regions. `CpuCompositor` is the
  reference; on the UI side `CompositeRenderer` (a `CanvasImageSource`) is the GPU seam.
- **Viewport** (`ViewportController`) is plain TypeScript owning its `<canvas>` and an overlay
  (ants, previews). Input skips React state, redraws coalesce per frame, readouts write the DOM.
- **Tools** (`src/ui/tools`) implement `Tool` (document-space pointer and key handlers, options
  panel, preview overlay). `ToolManager` holds the active tool; the viewport routes input to it
  after its own pan and zoom. Tools edit only through commands; painting tools run the core
  stroke engine once per frame. Colours and the clipboard are session state. More: @docs/tools.md
- **Transforms**: Crop, Canvas Size, turns and flips (lossless), Image Size and Rotate Layer are
  core commands; resampling interpolates premultiplied alpha. Details: @docs/transform.md

## Folder layout

```
index.html               Vite entry; vite.config.ts: build + Vitest config, production CSP
eslint.config.js         lint rules incl. core/browser import boundaries
tsconfig*.json           project references: core (no DOM), web (src/), node (configs)
docs/                    file-format.md, layers.md, tools.md, transform.md, deploy.md
src/
  core/                  pure logic – no DOM/React/Node; index.ts: the public barrel for ui/
    pixel-buffer.ts      RGBA8 buffers; pixel-snapshot.ts: saved pixel rects for undo
    geometry.ts          Rect helpers; layer.ts: Layer union; orientation.ts: quarter turns, flips
    selection.ts         Selection masks; selection-outline.ts: outline tracing for the ants
    document.ts          ImageDocument, layer IDs; floating-selection.ts: the Move tool's float
    editor.ts            Editor: document + history + change events + save point + active layer
    blank-document.ts    new (and startup) documents; demo-document.ts: the demo document
    history/             Command and History interfaces, LinearHistory
    commands/            layers, merge, selection, move, float, copy, stroke, fill, canvas, transforms
    compositor/          Compositor interface, CpuCompositor, compositeLayers (merge math)
    paint/               dab placement, stroke masks, paint math, colour sampling, flood regions
    resample/            kernels, resizing, affine transforms (premultiplied interpolation)
    serialization/       .soup read/write, PngCodec interface
  ui/
    main.tsx, App.tsx    bootstrap (wires editor, file store, codecs, tools) and layout
    use-*.ts             shortcut hooks; select-commands, *-actions, canvas-menu: menu actions
    io/                  FileStore, lossless PNG codec, browser decode, export encoders
    session/             DocumentSession, AppController, file types, Rotate Layer preview
    dialogs/             New, Export, Image/Canvas Size, Rotate, Fill, Duplicate Layer, confirm, error
    color/, clipboard/   Colors, HSV picker, colour math; PixelClipboard and system clipboard
    tools/               ToolManager; marquee, lasso, wand, move, brush, bucket, eyedropper, crop
    viewport/            ViewportController, ants overlay, view math, zoom and status readouts
    render/              CompositeRenderer (CPU → canvas; GPU seam)
    panels/              Toolbar, menus and ContextMenu, ToolPicker, ToolOptionsBar, LayerPanel
```

## Coding conventions

- Run `npm run format` before committing; Prettier owns formatting (single quotes, 100 cols, LF
  via `.gitattributes`).
- Use `import type` for type-only imports (`verbatimModuleSyntax`). UI code imports core through
  `src/core/index.ts`.
- File names: kebab-case for modules (`cpu-compositor.ts`), PascalCase for React components
  (`LayerPanel.tsx`). Tests sit next to the code as `*.test.ts`.
- Every new core behaviour gets unit tests. Pixel tests assert exact RGBA values worked out by
  hand, with the arithmetic in a comment when it's not obvious.
- Hot loops work on typed arrays with index arithmetic, with no per-pixel allocations or
  closures. Reuse scratch buffers.
- Exhaustive `switch` over unions with `assertNever`. No `any`; narrow interfaces between modules.
- Comment only what isn't obvious from the code (invariants, units, coordinate spaces, why).
- Coordinates: document space is integer pixels from the canvas's top-left; layer offsets map
  layer space into it, and the viewport maps it to CSS pixels with `screen = doc * zoom + pan`.

## Commands

| Script              | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Vite dev server (http://localhost:1619)             |
| `npm run build`     | type-check all projects, then production build      |
| `npm run preview`   | serve the production build                          |
| `npm test`          | run unit tests once (`npm run test:watch` to watch) |
| `npm run lint`      | ESLint + Prettier check                             |
| `npm run format`    | Prettier write                                      |
| `npm run typecheck` | `tsc -b` only                                       |

## Deployment

`main` deploys to Cloudflare and GitHub Pages; test PR previews before merging: @docs/deploy.md

## Planned build order

1. Document model + compositor (done)
2. Viewport: zoom/pan, checkerboard (done)
3. Undo/redo (done; new features add their own commands)
4. Open/save (done: new, open, save, import, export)
5. Selection as a mask + tool system (done: marquee tools, Select menu, marching ants)
   - then layer management (done: active layer, layer commands, Layer menu, thumbnails)
6. Move tool (done: layer moves and nudges, floating selections, pixel snapshots)
7. Brush / eraser (done: stroke engine, colours and picker, eyedropper)
8. Crop / rotate (done: Crop tool, Image menu, resampling engine)
9. Adjustments
10. Lasso + magic wand (done: lassos, Magic Wand, Paint Bucket, Edit menu with Fill and Clear)
11. Text
12. Transform, filters, layer masks

## Decisions

- **Pure web app, no Electron (for now).** The development machine's AppLocker policy blocks the
  unsigned `electron.exe` (Win32 error 1260). If a shell is revisited, use electron-vite 5 (works
  with Vite 7) and minimal main-process code; sandboxed preload scripts must be CommonJS.
- **Vite 7 for now.** Vite 8 runs on Rolldown/Oxc prebuilt binaries; check them against the
  no-Rust constraint (AppLocker in particular) before upgrading.
- **Startup** is a new blank 1920×1080 white document; the demo is under File → Demo Document.
- **`.soup` is the native format**: a zip of `document.json` plus one PNG per raster layer.
  PNG, JPEG and WebP are import and export only. Layer PNGs use the lossless codec in
  `src/ui/io/png.ts`, as canvas premultiplies. Spec, layer IDs, versioning: @docs/file-format.md

## Open decisions

Simplest choices made so far that may be revisited:

- **History storage**: `LinearHistory` keeps whole commands and their snapshots, up to 200 steps.
  Strokes keep 64 px tiles (11 MB to cover 1920×1200); Image Size and transforms keep whole layers.
- **Dirty rects for property changes** are the layer's bounds clipped to the canvas. Each change
  recomposites that rect synchronously; batching or tiling can come later if profiling demands it.
- **Viewport rendering**: zoom range 1 %–6400 %; bilinear below 100 %, nearest-neighbour at and
  above. The checkerboard uses fixed 8 CSS-px squares anchored to the document origin.
- **CSP**: production builds only; the dev server needs inline scripts for Fast Refresh.
- **File I/O limits**: PNG encoding and zipping run on the main thread (~150 ms at 1920×1080);
  use a worker if that hurts. The download fallback can't tell whether a download was kept, so
  it marks the document saved. Discard prompts offer Discard or Cancel, not Save. Browsers
  usually keep Ctrl/Cmd+N in normal tabs, so New may need the menu there.
- **Installable app**: a PWA is the likely route to a windowed, desktop-like app. Not started.
