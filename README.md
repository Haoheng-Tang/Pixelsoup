# Pixelsoup

An open-source, layered raster image editor that runs in your browser, like a lightweight
Photoshop.

> Early days: Pixelsoup currently opens a demo 800×600 document with two layers that you can
> view, zoom, pan, show/hide and fade. Painting, selections and file I/O are on the roadmap.

## Features so far

- Layered documents: per-layer RGBA pixels, position, opacity, visibility and blend mode
  (Normal)
- Viewport with a transparency checkerboard, zoom to cursor (mouse wheel) and pan
  (Space+drag or middle-mouse drag)
- Layer panel with visibility toggles and opacity sliders that update live
- Undo/redo for every edit (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y)

## Requirements

- Node.js 20.19+ or 22.12+ (required by Vite 7) with npm
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
