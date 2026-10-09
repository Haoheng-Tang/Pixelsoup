# feat: scaffold Pixelsoup (document model, compositor, viewport, layer panel)

## Summary

First milestone for Pixelsoup, an open-source layered raster image editor that runs in the
browser. This sets up the tooling and core architecture, then builds a working end-to-end slice
on top. On launch the app opens an 800×600 demo document with two layers, shown over a
transparency checkerboard. You can zoom and pan it, toggle layer visibility, fade layers with an
opacity slider, and undo/redo every edit.

The original plan included a thin Electron desktop shell. It was dropped because the
development machine's AppLocker policy blocks `electron.exe` (Win32 error 1260), so it could
never be run. Pixelsoup is a pure web app for now; the reasoning and how to revisit it are in
`CLAUDE.md` → "Decisions".

## What's included

Commits are meant to be reviewed one at a time:

1. **Tooling**: TypeScript (strict + `exactOptionalPropertyTypes`), Vite 7, React 19, Vitest,
   type-checked ESLint and Prettier, `.gitattributes` forcing LF, and a CSP injected into
   production builds.
2. **Core model** (`src/core`):
   - `ImageDocument` holds an ordered layer stack and a reserved `Selection` (8-bit mask) slot.
   - `RasterLayer` stores RGBA8 sRGB pixels with straight alpha, plus offset, opacity,
     visibility and blend mode. It is one member of a `Layer` union keyed on `kind`, so text and
     adjustment layers can be added later.
   - Command-based undo/redo: `Command` and `History` interfaces, `LinearHistory`, and an
     `Editor` that broadcasts changes.
   - `src/core` cannot use the DOM, React, Node or Electron. `tsconfig.core.json` (no DOM lib,
     no `@types`) and ESLint import rules both enforce this.
3. **Compositor**:
   - The `Compositor` interface takes dirty rectangles, so a WebGL/WebGPU version can replace
     the CPU one later.
   - `CpuCompositor` does Normal blending with per-layer opacity, working row by row in a
     premultiplied float buffer.
   - Tests cover opacity, visibility, stacking, positive/negative/off-canvas offsets, alpha
     blending against hand-computed RGBA values, and dirty-rect clipping and rounding.
4. **Viewport**:
   - `ViewportController` draws to the canvas directly, outside React: mouse-wheel zoom centred
     on the cursor, pan with Space+drag or middle-drag, a checkerboard, sharp rendering on
     high-DPI screens, and one redraw per animation frame.
   - `CompositeRenderer` is the hook for plugging in a GPU renderer later.
   - The zoom % updates the page directly, without re-rendering React.
5. **Layer panel and history UI**:
   - The panel shows the visibility toggle and opacity slider for each layer and updates live.
     Every edit goes through `History`, and one slider drag is one undo step.
   - Undo/Redo buttons, plus Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y.
6. **Pure web app**: removes the build and lint scaffolding that only existed for Electron.
7. **Docs**: `CLAUDE.md` (workflow, stack, no-Rust constraint, architecture rules, conventions,
   build order, decisions, open decisions) and the README.
8. **Node versions**: `engines.node` is `^22.13.0 || ^24.0.0 || >=26.0.0`, the range Vite 7,
   Vitest 5 and ESLint 10 all support.

## How to verify

Requires Node 22.13+, 24.x or 26+.

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 38 tests across 5 files
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

In the browser:

- [ ] The demo document appears fitted to the window, with "Test Pattern" above "Background" in
      the layer panel, and the checkerboard showing through transparent areas.
- [ ] The mouse wheel zooms around the cursor, and the zoom % in the toolbar updates. −, +, Fit
      and 100% work.
- [ ] Space+drag and middle-mouse drag both pan; the checkerboard moves with the image.
- [ ] The eye button hides and shows a layer; the canvas updates immediately.
- [ ] Dragging an opacity slider fades the layer live. One Ctrl+Z undoes the whole drag, and
      Ctrl+Y (or Ctrl+Shift+Z) redoes it.
- [ ] Optional: temporarily reference `document` in a `src/core` file, or add a `node:` import
      anywhere under `src/`; `npm run lint` and `npm run build` should both reject it.

## Deliberately out of scope

- **Desktop shell (Electron)**: blocked by AppLocker on the development machine; see
  `CLAUDE.md`.
- **Open/save, new document**: next on the build order. The startup document is a hard-coded
  demo for now.
- **Selection tools, move, brush/eraser, crop/rotate, adjustments, text, transforms, filters,
  layer masks**: later build-order steps. The `Selection` type and document slot are reserved
  but unused.
- **Blend modes other than Normal**, and a **GPU (WebGL/WebGPU) compositor**: the interfaces
  allow for them, but nothing is implemented.
- **Colour management**: 8-bit sRGB only, by design.
- **Layer management** (add, delete, reorder, rename) and **memory-aware history** for pixel
  edits.
- **PWA / installable app** and **CI**: no workflow is configured yet, so lint, test and build
  were run locally (including from a fresh clone with `npm ci`).
