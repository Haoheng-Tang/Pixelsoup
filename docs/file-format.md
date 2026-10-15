# The `.soup` file format

Pixelsoup's native, layered document format. Implemented in
`src/core/serialization/pixelsoup-format.ts`; keep this spec and that file in step.

## Extension

Documents are saved as `.soup` files (`Untitled-1.soup`): Save and Save As suggest it, the
save picker offers it and the download fallback uses it (`src/ui/session/file-types.ts`).

Earlier versions saved the same format as `.pixelsoup`, and those files still open: the
extension changed, not the format (still `formatVersion` 1). An opened `.pixelsoup` file is
the file Save writes back to, under its old name, where the browser can save in place; Save
As, and every save that downloads a copy, suggest the `.soup` name.

## Container

A `.soup` file is a standard zip archive (written with `fflate`):

| Path              | Contents                                     | Compression |
| ----------------- | -------------------------------------------- | ----------- |
| `document.json`   | the manifest (UTF-8 JSON, described below)   | deflate     |
| `layers/<id>.png` | one PNG per raster layer, named after its ID | stored      |

PNGs are already compressed, so they are stored rather than deflated again. Readers find layer
images through each layer's `file` field, not by assuming the `layers/<id>.png` naming, and
ignore any archive entries the manifest doesn't reference.

MIME type used by the app: `application/x-pixelsoup`. Readers detect the format by the
`.soup` or `.pixelsoup` extension or the zip signature `PK\x03\x04`.

## `document.json`

```json
{
  "formatVersion": 1,
  "width": 1920,
  "height": 1080,
  "layers": [
    {
      "id": "layer-1",
      "name": "Background",
      "kind": "raster",
      "x": 0,
      "y": 0,
      "width": 1920,
      "height": 1080,
      "opacity": 1,
      "visible": true,
      "blendMode": "normal",
      "file": "layers/layer-1.png"
    }
  ]
}
```

| Field           | Type    | Meaning                                                |
| --------------- | ------- | ------------------------------------------------------ |
| `formatVersion` | integer | `1`. See "Versioning".                                 |
| `width`         | integer | canvas width in pixels, 1–8192                         |
| `height`        | integer | canvas height in pixels, 1–8192                        |
| `layers`        | array   | layer entries in stack order: **bottom first** (`[0]`) |

Every layer entry has these fields, whatever its kind:

| Field       | Type    | Meaning                                                          |
| ----------- | ------- | ---------------------------------------------------------------- |
| `id`        | string  | 1–64 characters from `A–Z a–z 0–9 - _`; unique within the file   |
| `name`      | string  | display name (any text, may repeat)                              |
| `kind`      | string  | layer type; discriminates the remaining fields. Only `"raster"`. |
| `opacity`   | number  | 0–1                                                              |
| `visible`   | boolean |                                                                  |
| `blendMode` | string  | `"normal"` (the only mode so far)                                |

A `"raster"` entry adds:

| Field    | Type    | Meaning                                                        |
| -------- | ------- | -------------------------------------------------------------- |
| `x`, `y` | integer | canvas position of the image's top-left pixel; may be negative |
| `width`  | integer | image width in pixels, 1–8192; must match the PNG              |
| `height` | integer | image height in pixels, 1–8192; must match the PNG             |
| `file`   | string  | archive path of the image, e.g. `layers/layer-1.png`           |

Layer images may extend past the canvas; nothing is cropped on save.

### Pixel data

Each layer PNG holds the layer's pixels exactly: 8-bit sRGB with straight (non-premultiplied)
alpha. Pixelsoup writes RGBA, 8 bits per channel, non-interlaced, with an `sRGB` chunk, using
its own encoder (`src/ui/io/png.ts`) so translucent pixels survive unchanged; the browser's
canvas would premultiply and round them. On read, any standard PNG colour type and bit depth is
accepted and converted to RGBA8 (16-bit channels are rounded to 8 bits). The selection is not
saved.

## Layer IDs

IDs are generated per document by `createLayerId(doc)` as `layer-1`, `layer-2`, … and are
stored as-is, so they survive save and load. After loading, numbering continues after the
highest `layer-N` in the file, so new layers never reuse an ID. IDs only need to be unique
within one document; hand-written files may use any ID that matches the pattern above.

## Validation

Opening fails with a `DocumentFormatError` and a message for the user when:

- the file isn't a zip archive, or has no `document.json`, or it isn't a JSON object;
- `formatVersion` is missing, not a positive integer, or newer than the reader supports;
- the document or a layer size isn't a whole number from 1 to 8192, or a position isn't an
  integer;
- a layer ID is missing, malformed, or duplicated, or the name isn't a string;
- `opacity` is outside 0–1, `visible` isn't a boolean, or the kind or blend mode is unknown;
- a layer's PNG is missing, unreadable, or not the size the manifest says.

Unknown fields are ignored.

## Versioning

`formatVersion` changes only when a reader of the previous version would misread a file.

- **No bump**: new optional fields that older readers can safely ignore, new archive entries,
  and new layer kinds or blend modes. An older reader rejects a file that uses a kind or blend
  mode it doesn't know, with a clear message, rather than dropping or misdrawing that layer.
- **Bump**: changing the meaning, units or requirements of an existing field, or adding data
  that must not be ignored (for example layer masks that change how a layer composites). A
  reader rejects any version newer than its own.

New layer kinds become new members of the layer-entry union, discriminated by `kind`, with the
common fields above plus their own (for example `text` with its string and font, or `adjustment`
with its parameters). Layers without pixels have no `file`.
