# CLAUDE.md

Guidance for AI assistants and contributors working on Pixelsoup, an open-source layered
raster image editor (a lightweight Photoshop) that runs entirely in the browser.

## Git workflow

- `main` must always lint, test, and build. Never commit directly to `main`.
- All work happens on `feat/*`, `fix/*`, or `chore/*` branches and lands on `main` via pull
  request.
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

### No-Rust constraint (hard)

Rust is not available on the development machine and must not be used anywhere: no Rust
toolchain, no Rust source, no Tauri, and no Rust-first JavaScript tooling (Rolldown, Oxc, SWC,
Lightning CSS, Biome, …). This is why Vite is pinned to 7.x (Vite 8 is built on Rolldown/Oxc)
and React is compiled by `@vitejs/plugin-react` (Babel/esbuild), not the SWC variant.

Agreed exception: Rollup 4 (inside Vite 7) ships a small prebuilt native parser compiled from
Rust. That is acceptable because it is a transitive prebuilt binary, not Rust tooling we choose
or build. Don't introduce new packages whose main job is a Rust-compiled binary.

### Colors

8-bit sRGB only, straight (non-premultiplied) alpha. No color management, ICC profiles, high
bit depth, or linear-light blending. Blending operates directly on sRGB-encoded values (as most
editors do by default). Imported images will be treated as sRGB.

## Architecture rules

- **`src/core/`** holds pure document and pixel logic. Zero DOM, React, Node, or Electron
  imports; fully unit-testable. This is enforced twice: `tsconfig.core.json` compiles core
  without the DOM lib or any `@types`, and ESLint restricts its imports.
- **`src/ui/`** holds React panels plus the imperative canvas viewport. It may import core, never
  the other way round. Browser code must not import Node or Electron APIs (lint-enforced).
- **Document model**: `ImageDocument` has `width`, `height`, an ordered layer stack
  (`layers[0]` is the bottom) and a `selection` slot.
- **Layers** are a discriminated union on `kind`. Today only `RasterLayer` exists: its own
  `PixelBuffer` (RGBA8, sRGB, straight alpha), an offset `x`/`y` (may be negative or extend past
  the canvas), `opacity` (0–1), `visible`, and `blendMode`. Text and adjustment layers are added
  as new union members; every `switch (layer.kind)` ends in `assertNever` so the compiler points
  to each place that needs updating. Shared properties live in `LayerBase`.
- **Selection** is an 8-bit mask the size of the canvas (`Selection`). `null` on the document
  means "no selection" (everything editable). The type is reserved; no tools exist yet.
- **Undo/redo is command-based.** Every document mutation is a `Command` (`apply` / `revert`)
  executed through `History` (`editor.history.execute(cmd)`). Nothing may mutate an
  `ImageDocument` any other way. Continuous gestures (slider drags, brush strokes) use a shared
  `mergeKey` so one gesture is one undo step. Commands return a `DocumentChange` with the
  canvas-space dirty rect.
- **`Editor`** owns one document plus its history and broadcasts each `DocumentChange` to
  subscribers (the viewport and panels).
- **Compositor**: `Compositor.composite(doc, dirtyRects?)` flattens visible layers (Normal blend
  × layer opacity) into its own output and only needs to touch the dirty regions.
  `CpuCompositor` is the reference implementation. On the UI side, `CompositeRenderer` is the
  seam for a GPU compositor: it exposes the composite as a `CanvasImageSource`.
- **Viewport** (`ViewportController`) is plain TypeScript that owns its `<canvas>`. Input
  (wheel/pointer/keys) never goes through React state; redraws are coalesced with
  `requestAnimationFrame`. React only mounts and unmounts it. Readouts such as the zoom % update
  the DOM directly.

## Folder layout

```
index.html               Vite entry
vite.config.ts           build + Vitest config, production CSP
eslint.config.js         lint rules incl. core/browser import boundaries
tsconfig*.json           project references: core (no DOM), web (src/), node (configs)
src/
  core/                  pure logic – no DOM/React/Node
    geometry.ts          Rect helpers
    pixel-buffer.ts      RGBA8 buffers
    layer.ts             Layer union, RasterLayer, BlendMode
    selection.ts         Selection mask type (reserved)
    document.ts          ImageDocument
    editor.ts            Editor: document + history + change events
    demo-document.ts     startup document (800×600, two layers)
    history/             Command and History interfaces, LinearHistory
    commands/            concrete commands (layer visibility, opacity, …)
    compositor/          Compositor interface, CpuCompositor (+ tests)
    index.ts             public barrel used by ui/
  ui/
    main.tsx, App.tsx    bootstrap and layout
    styles.css
    viewport/            ViewportController, view-transform math, Viewport/ZoomIndicator
    render/              CompositeRenderer (CPU → canvas; GPU seam)
    panels/              Toolbar, LayerPanel
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
- Exhaustive `switch` over unions with `assertNever`.
- No `any`. Prefer narrow interfaces at module boundaries.
- Comment only what isn't obvious from the code (invariants, units, coordinate spaces, why).
- Coordinates: document space is integer pixels from the canvas's top-left. Layer offsets
  translate layer space to document space. The viewport maps document space to CSS pixels with
  `screen = doc * zoom + pan`.

## Commands

| Script              | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Vite dev server (http://localhost:5173)             |
| `npm run build`     | type-check all projects, then production build      |
| `npm run preview`   | serve the production build                          |
| `npm test`          | run unit tests once (`npm run test:watch` to watch) |
| `npm run lint`      | ESLint + Prettier check                             |
| `npm run format`    | Prettier write                                      |
| `npm run typecheck` | `tsc -b` only                                       |

## Planned build order

1. Document model + compositor (done)
2. Viewport: zoom/pan, checkerboard (done)
3. Undo/redo (command-based history exists; extend as features land)
4. Open/save
5. Rectangular selection as a mask
6. Move tool
7. Brush / eraser
8. Crop / rotate
9. Adjustments
10. Lasso + magic wand
11. Text
12. Transform, filters, layer masks

## Decisions

- **Pure web app, no Electron (for now).** The original plan was a thin Electron shell
  (electron-vite, context isolation + sandbox, typed `window.pixelsoup` preload bridge). It was
  dropped because the development machine's AppLocker policy denies the unsigned
  `electron.exe` by default (Win32 error 1260, "blocked by group policy"), so the desktop build
  could never be run or verified. Desktop-like features will use web platform APIs instead: the
  File System Access API for open/save (Chromium), with `<input type="file">` and download
  fallbacks elsewhere. If a desktop shell is revisited, use electron-vite 5 (compatible with
  Vite 7), keep main-process code minimal, and note that sandboxed preload scripts must be
  CommonJS.
- **Vite 7, not 8**: see the no-Rust constraint.
- **`ImageDocument`**, not `Document`, to avoid clashing with the DOM global.

## Open decisions

Simplest choices made so far that may be revisited:

- **History storage**: `LinearHistory` keeps whole command objects with a 200-step cap. Pixel
  commands will need memory-aware storage (e.g. tiled diffs) behind the same interface.
- **Layer IDs** come from a module-level counter (`layer-1`, …). Revisit when documents are
  loaded from files (IDs must be unique per document and survive save/load).
- **Opacity** is stored as a float in 0–1. The UI slider uses whole percents.
- **Dirty rects for property changes** are the layer's bounds clipped to the canvas. Each change
  recomposites that rect synchronously; batching or tiling can come later if profiling demands it.
- **Viewport rendering**: zoom range 1 %–6400 %. Bilinear smoothing below 100 %,
  nearest-neighbour at and above 100 %. The checkerboard uses fixed 8 CSS-px squares anchored to
  the document origin.
- **Panning**: space+drag only takes Space while the pointer is over (or focus is on) the
  canvas, so Space still activates focused buttons elsewhere.
- **CSP**: injected only into production builds; the dev server needs inline scripts for Fast
  Refresh.
- **File formats for open/save**: not decided. Likely PNG/JPEG/WebP via the browser's codecs
  plus a native layered format later.
- **Installable app**: a PWA (web manifest; offline support would need a service worker) is the
  likely route to a windowed, desktop-like experience. Not started.
