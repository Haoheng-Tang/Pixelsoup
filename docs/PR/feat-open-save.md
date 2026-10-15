# feat: new, open, save, import and export documents

## Summary

Step 4 of the build order. Pixelsoup now starts with a new blank document instead of the
hard-coded demo, and has a File menu: New, Open, Import Image as Layer, Save, Save As, Export,
Close and Demo Document.

- Documents are saved in a new native layered format, `.soup`: a zip of `document.json`
  plus one PNG per layer, specified in `docs/file-format.md`.
- PNG, JPEG and WebP images can be opened as a new document or imported as a centred layer.
- The visible layers can be exported, flattened, as PNG, JPEG (with a quality slider) or WebP.
- The toolbar and window title show the document name and a ● marker for unsaved changes.
  Pixelsoup asks before New, Open, Close, Demo Document or leaving the page throws them away.
- Shortcuts: Ctrl/Cmd+N, O, S, Shift+S and Shift+E.

In Chromium browsers (Chrome, Edge) files go through the File System Access API, so Save writes
back to the same file. Other browsers open files with `<input type="file">` and download a copy
on every Save or Export. Both paths sit behind a small `FileStore` interface in `src/ui`; core
never sees files, handles or the DOM.

## What's included

Commits are meant to be reviewed one at a time:

1. **Per-document layer IDs**: the module-level counter is gone. `createLayerId(doc)` hands out
   `layer-1`, `layer-2`, … from a counter on the document and skips IDs already in use, so IDs
   are unique per document and survive save and load. `AddLayerCommand` rejects duplicates.
2. **Save point, document replacement, blank documents**:
   - `History.stateId` identifies the document state. Every execute (including a merged one)
     gets a new, never-reused ID, and undo/redo return to the recorded IDs.
   - `Editor` tracks the save point (`isDirty`, `markSaved`) and gains `replaceDocument`, which
     swaps in another document with a fresh, clean history and announces the swap.
   - `createBlankDocument` (1–8192 px, white or transparent background) and `MAX_IMAGE_SIZE`.
3. **`.soup` serialization in core**: `serializeDocument` / `deserializeDocument` with an
   injected `PngCodec`, so core stays DOM-free. Loading validates the whole manifest and throws
   `DocumentFormatError` with a message written for the user. Adds `fflate` (pre-approved).
4. **Lossless PNG codec and image decoding** (`src/ui/io`): a small pure-TypeScript PNG
   encoder/decoder. Canvas premultiplies alpha, which would shift translucent pixels on every
   save; this codec keeps straight-alpha RGBA8 exact. JPEG, WebP and the rare PNG variants it
   doesn't decode (e.g. interlaced) go through `createImageBitmap` and a canvas.
5. **`FileStore` seam**: `FileSystemAccessStore` (open/save pickers, writes back through the
   handle, asks for write permission when needed) and `DownloadFileStore` (file input,
   downloads), chosen once at startup. File contents are produced only after the destination is
   chosen, so pickers open while the click or key press still counts as user activation.
6. **Document session and command controller** (`src/ui/session`): `DocumentSession` runs new,
   open, save, import and export and owns the document name and save target. `AppController`
   runs File commands, confirms discards, tracks the open dialog and ignores commands while one
   is open or a file operation is running. Both are plain TypeScript, unit-tested against an
   in-memory `FileStore`. The viewport rebuilds and refits when the document is replaced.
7. **Export**: PNG through the exact encoder; JPEG and WebP through canvas `toBlob`. JPEG is
   flattened onto white first (`flattenOnto` in core). Browsers that can't encode a format get a
   clear error instead of a mislabelled PNG.
8. **File menu, dialogs, unsaved changes and shortcuts**: a WAI-ARIA menu button, native
   `<dialog>`-based New Document, Export, Discard and Error dialogs, the name and ● marker in the
   toolbar and title, a `beforeunload` prompt, and the shortcuts. Undo/redo is disabled while a
   dialog is open or a file operation runs. New and Export remember their last settings.
9. **Docs**: `docs/file-format.md` (imported from `CLAUDE.md`); `CLAUDE.md` marks step 4 done,
   describes the `FileStore` seam and resolves the startup-document, layer-ID and file-format
   open decisions; the README lists the new features and the Chromium note for Save.

## The `.soup` format

```
holiday.soup (zip)
├── document.json        deflated
└── layers/layer-1.png   stored (already compressed), one per raster layer
```

`document.json` has `formatVersion` (1), the canvas `width`/`height`, and `layers` bottom first.
Each layer entry has `id`, `name`, `kind`, `opacity`, `visible` and `blendMode`; a `"raster"`
entry adds `x`, `y`, `width`, `height` and `file` (its PNG's path in the archive). Layer entries
are a union on `kind`, so text and adjustment layers can be added later as new members without
changing existing entries. Readers ignore unknown fields and entries, and reject newer format
versions, unknown kinds and unknown blend modes with a clear message rather than dropping data.
The full spec and versioning policy are in `docs/file-format.md`.

## How to verify

```sh
npm ci
npm run lint     # ESLint + Prettier check
npm test         # 137 tests across 14 files
npm run build    # tsc -b for core/web/node projects, then vite build
npm run dev      # http://localhost:1619
```

Unit tests cover, among others: serialize → deserialize round trips (dimensions, layer metadata,
exact pixels) with a fake PNG codec; rejection of a newer or malformed `formatVersion`, a missing
layer file, mismatched layer dimensions, bad sizes, properties, kinds and blend modes, and
non-zip input; layer-ID uniqueness after load; the PNG codec (exact round trips of every alpha
value, each colour type, low and 16-bit depths, damaged input); save-point tracking through
undo, redo and merged gestures; and the session and controller flows (confirm, cancel, errors,
save in place versus download).

In Chrome or Edge:

- [ ] Startup shows a blank white 1920×1080 "Untitled-1".
- [ ] File → New…: sizes outside 1–8192 disable Create; a transparent background shows the
      checkerboard.
- [ ] An edit (e.g. a layer's opacity) shows ● in the toolbar and tab title; undoing back to the
      saved state clears it.
- [ ] Ctrl+S asks where to save; the next Ctrl+S writes the same file without asking; Save As
      asks again.
- [ ] Reload, then File → Open the saved file: layers, positions, opacity, visibility and pixels
      are identical.
- [ ] File → Import Image as Layer… with a JPEG adds a centred layer named after the file; one
      Ctrl+Z removes it.
- [ ] File → Open on a PNG, JPEG or WebP gives a one-layer document; Save then asks for a new
      `.soup` file and never overwrites the image.
- [ ] Ctrl+Shift+E exports PNG, JPEG (quality slider; transparent areas become white) and WebP.
- [ ] With unsaved changes, New, Open, Close, Demo Document and closing or reloading the tab all
      ask first; Cancel keeps the document.
- [ ] Opening a file that isn't an image or a valid `.soup` shows an error and leaves the
      current document unchanged.

In Firefox or Safari:

- [ ] Open uses the browser's file chooser; Save, Save As and Export download a file.

These checks were run in Edge, including the full new → edit → save → reload → open round trip
(compared pixel for pixel), JPEG import as a layer, PNG export, and the download fallback with
the pickers disabled.

## Known limitations

- **Ctrl/Cmd+N**: browsers usually keep it for a new window in a normal tab; use File → New.
- **Main-thread encoding**: PNG encoding and zipping run on the main thread (about 150 ms for a
  1920×1080 layer). A worker can take this over if larger documents make it noticeable.
- **Download fallback**: the page can't tell whether a download was kept, so Save marks the
  document as saved once the download starts.
- **Discard prompt** offers Discard or Cancel, not Save: a save picker would need another user
  activation.
- **Canvas precision**: JPEG/WebP import and WebP export go through a canvas, so translucent
  pixels may lose a little colour precision. `.soup` files and PNG export are exact.
- **Write permission**: if the user denies write access to an opened file, Save does nothing;
  Save As still works.
- **Old browsers**: the file-input fallback relies on the input's `cancel` event (Firefox 91+,
  Safari 16.4+). On older browsers, cancelling Open leaves File commands blocked until reload.

## Deliberately out of scope

- **Several open documents**, recent files, autosave and crash recovery.
- **Saving the selection**: there are no selection tools yet (step 5).
- **Layer management** (delete, reorder, rename) beyond importing an image as a layer.
- **Opening `.soup` files from the OS** (file handlers need the PWA, which isn't started).
- **Exporting single layers**, colour profiles and high bit depth (8-bit sRGB only, by design).
