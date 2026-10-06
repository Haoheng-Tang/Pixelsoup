import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  duplicateLayerCommand,
  renameLayerCommand,
  reorderLayerCommand,
} from '../commands/layer-commands';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { createRasterLayer } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer, setPixel } from '../pixel-buffer';
import {
  DocumentFormatError,
  FORMAT_VERSION,
  MANIFEST_PATH,
  deserializeDocument,
  parseManifest,
  serializeDocument,
} from './pixelsoup-format';
import type { PngCodec } from './png-codec';

/**
 * Stand-in for a PNG codec: "FAKE", width and height as little-endian u32, raw RGBA.
 * Lossless by construction, so the tests exercise the format rather than PNG.
 */
const fakePng: PngCodec = {
  encode(pixels) {
    const out = new Uint8Array(12 + pixels.data.length);
    out.set(strToU8('FAKE'));
    const view = new DataView(out.buffer);
    view.setUint32(4, pixels.width, true);
    view.setUint32(8, pixels.height, true);
    out.set(pixels.data, 12);
    return Promise.resolve(out);
  },
  decode(png) {
    if (strFromU8(png.subarray(0, 4)) !== 'FAKE') return Promise.reject(new Error('bad magic'));
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const width = view.getUint32(4, true);
    const height = view.getUint32(8, true);
    const data = new Uint8ClampedArray(png.subarray(12));
    return Promise.resolve({ width, height, data });
  },
};

function fakeImage(width: number, height: number): Uint8Array {
  const out = new Uint8Array(12 + width * height * 4);
  out.set(strToU8('FAKE'));
  const view = new DataView(out.buffer);
  view.setUint32(4, width, true);
  view.setUint32(8, height, true);
  return out;
}

/** 3×2 canvas with a translucent, offset, hidden top layer over an opaque background. */
function sampleDocument(): ImageDocument {
  const doc = createDocument(3, 2);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: 3,
    height: 2,
  });
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) setPixel(background.pixels, x, y, [x * 100, y * 200, 7, 255]);
  }
  const overlay = createRasterLayer({
    id: createLayerId(doc),
    name: 'Überlay "1"',
    width: 2,
    height: 3,
    x: -1,
    y: 1,
    opacity: 0.35,
    visible: false,
  });
  // Semi-transparent colours, which canvas-based codecs would round.
  setPixel(overlay.pixels, 0, 0, [200, 100, 50, 10]);
  setPixel(overlay.pixels, 1, 2, [7, 9, 250, 3]);
  doc.layers.push(background, overlay);
  return doc;
}

function manifestJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    width: 4,
    height: 3,
    layers: [
      {
        id: 'layer-1',
        name: 'Background',
        kind: 'raster',
        x: 0,
        y: 0,
        width: 4,
        height: 3,
        opacity: 1,
        visible: true,
        blendMode: 'normal',
        file: 'layers/layer-1.png',
      },
    ],
    ...overrides,
  };
}

function archive(manifest: unknown, files: Zippable = {}): Uint8Array {
  const json = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  return zipSync({ [MANIFEST_PATH]: strToU8(json), ...files });
}

function layerOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  const base = manifestJson();
  const [layer] = base['layers'] as Record<string, unknown>[];
  return { ...base, layers: [{ ...layer, ...overrides }] };
}

async function expectFormatError(bytes: Uint8Array, message: RegExp): Promise<void> {
  const result = deserializeDocument(bytes, fakePng);
  await expect(result).rejects.toBeInstanceOf(DocumentFormatError);
  await expect(result).rejects.toThrow(message);
}

function pixelsOf(doc: ImageDocument, index: number): PixelBuffer {
  const layer = doc.layers[index];
  if (!layer) throw new Error(`no layer ${index}`);
  return layer.pixels;
}

describe('serializeDocument / deserializeDocument', () => {
  it('round-trips dimensions, layer metadata and pixel data', async () => {
    const original = sampleDocument();
    const loaded = await deserializeDocument(await serializeDocument(original, fakePng), fakePng);

    expect(loaded.width).toBe(3);
    expect(loaded.height).toBe(2);
    expect(loaded.selection).toBeNull();
    expect(loaded.layers).toEqual(original.layers);
    // Pixel buffers are equal by value but not shared.
    expect(pixelsOf(loaded, 1).data).not.toBe(pixelsOf(original, 1).data);
    expect(Array.from(pixelsOf(loaded, 1).data.subarray(0, 4))).toEqual([200, 100, 50, 10]);
  });

  it('writes document.json and one image per layer', async () => {
    const files = unzipSync(await serializeDocument(sampleDocument(), fakePng));
    expect(Object.keys(files).sort()).toEqual([
      MANIFEST_PATH,
      'layers/layer-1.png',
      'layers/layer-2.png',
    ]);
    const manifest: unknown = JSON.parse(strFromU8(files[MANIFEST_PATH] ?? new Uint8Array()));
    expect(manifest).toEqual({
      formatVersion: FORMAT_VERSION,
      width: 3,
      height: 2,
      layers: [
        {
          id: 'layer-1',
          name: 'Background',
          kind: 'raster',
          x: 0,
          y: 0,
          width: 3,
          height: 2,
          opacity: 1,
          visible: true,
          blendMode: 'normal',
          file: 'layers/layer-1.png',
        },
        {
          id: 'layer-2',
          name: 'Überlay "1"',
          kind: 'raster',
          x: -1,
          y: 1,
          width: 2,
          height: 3,
          opacity: 0.35,
          visible: false,
          blendMode: 'normal',
          file: 'layers/layer-2.png',
        },
      ],
    });
  });

  it('round-trips a document with no layers', async () => {
    const loaded = await deserializeDocument(
      await serializeDocument(createDocument(5, 6), fakePng),
      fakePng,
    );
    expect(loaded.width).toBe(5);
    expect(loaded.layers).toEqual([]);
  });

  it('round-trips duplicated, renamed and reordered layers', async () => {
    const doc = sampleDocument();
    duplicateLayerCommand(doc, 'layer-1')?.apply(doc);
    renameLayerCommand(doc, 'layer-2', 'Top')?.apply(doc);
    reorderLayerCommand(doc, 'layer-2', 0)?.apply(doc);

    const loaded = await deserializeDocument(await serializeDocument(doc, fakePng), fakePng);
    expect(loaded.layers.map((layer) => [layer.id, layer.name])).toEqual([
      ['layer-2', 'Top'],
      ['layer-1', 'Background'],
      ['layer-3', 'Background copy'],
    ]);
    expect(loaded.layers).toEqual(doc.layers);
    expect(createLayerId(loaded)).toBe('layer-4');
  });

  it('captures layer properties when called, not when encoding finishes', async () => {
    const doc = sampleDocument();
    const saving = serializeDocument(doc, fakePng);
    const overlay = doc.layers[1];
    if (overlay) overlay.name = 'renamed later';
    const loaded = await deserializeDocument(await saving, fakePng);
    expect(loaded.layers[1]?.name).toBe('Überlay "1"');
  });

  it('ignores fields and archive entries it does not know', async () => {
    const manifest = manifestJson({ app: 'future', layers: [] });
    const doc = await deserializeDocument(
      archive(manifest, { 'thumbnail.png': strToU8('x') }),
      fakePng,
    );
    expect(doc.width).toBe(4);
    const withExtraLayerField = layerOverrides({ locked: true });
    const loaded = await deserializeDocument(
      archive(withExtraLayerField, { 'layers/layer-1.png': fakeImage(4, 3) }),
      fakePng,
    );
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.layers[0]).not.toHaveProperty('locked');
  });

  it('reads layers from any file path the manifest names', async () => {
    const manifest = layerOverrides({ file: 'pixels/bg.png' });
    const doc = await deserializeDocument(
      archive(manifest, { 'pixels/bg.png': fakeImage(4, 3) }),
      fakePng,
    );
    expect(pixelsOf(doc, 0).width).toBe(4);
  });
});

describe('layer IDs after loading', () => {
  it('keeps saved IDs and continues numbering past the highest', async () => {
    const doc = sampleDocument();
    const loaded = await deserializeDocument(await serializeDocument(doc, fakePng), fakePng);
    expect(loaded.layers.map((layer) => layer.id)).toEqual(['layer-1', 'layer-2']);
    expect(createLayerId(loaded)).toBe('layer-3');
  });

  it('allocates IDs that no loaded layer uses, whatever the saved IDs look like', async () => {
    const doc = createDocument(2, 2);
    for (const id of ['layer-7', 'imported', 'layer-2', 'layer-x']) {
      doc.layers.push(createRasterLayer({ id, name: id, width: 1, height: 1 }));
    }
    const loaded = await deserializeDocument(await serializeDocument(doc, fakePng), fakePng);
    const fresh = [createLayerId(loaded), createLayerId(loaded), createLayerId(loaded)];
    const all = [...loaded.layers.map((layer) => layer.id), ...fresh];
    expect(new Set(all).size).toBe(all.length);
    expect(fresh).toEqual(['layer-8', 'layer-9', 'layer-10']);
  });

  it('rejects duplicate layer IDs', async () => {
    const base = manifestJson();
    const [layer] = base['layers'] as unknown[];
    await expectFormatError(
      archive({ ...base, layers: [layer, layer] }, { 'layers/layer-1.png': fakeImage(4, 3) }),
      /id "layer-1", which another layer already uses/,
    );
  });

  it('rejects IDs that are not path-safe', async () => {
    await expectFormatError(archive(layerOverrides({ id: '../evil' })), /invalid id/);
    await expectFormatError(archive(layerOverrides({ id: '' })), /invalid id/);
  });
});

describe('deserializeDocument rejects bad input', () => {
  it('rejects a newer formatVersion with an upgrade hint', async () => {
    await expectFormatError(
      archive(manifestJson({ formatVersion: FORMAT_VERSION + 1 })),
      /format version 2.*Update Pixelsoup/,
    );
  });

  it('rejects a missing or malformed formatVersion', async () => {
    const unversioned = manifestJson();
    delete unversioned['formatVersion'];
    await expectFormatError(archive(unversioned), /formatVersion is missing/);
    await expectFormatError(archive(manifestJson({ formatVersion: '1' })), /formatVersion is "1"/);
    await expectFormatError(archive(manifestJson({ formatVersion: 0 })), /formatVersion is 0/);
    await expectFormatError(archive(manifestJson({ formatVersion: 1.5 })), /formatVersion/);
  });

  it('rejects a missing layer file', async () => {
    await expectFormatError(
      archive(manifestJson()),
      /Layer "Background": its image layers\/layer-1\.png is missing/,
    );
  });

  it('rejects a layer image whose size does not match document.json', async () => {
    await expectFormatError(
      archive(manifestJson(), { 'layers/layer-1.png': fakeImage(4, 2) }),
      /is 4×2 pixels, but document\.json says 4×3/,
    );
  });

  it('rejects a layer image the codec cannot decode', async () => {
    await expectFormatError(
      archive(manifestJson(), { 'layers/layer-1.png': strToU8('not a png') }),
      /not a readable PNG \(bad magic\)/,
    );
  });

  it('rejects invalid document dimensions', async () => {
    for (const size of [
      { width: 0, height: 3 },
      { width: 8193, height: 3 },
      { width: 4, height: 2.5 },
      { width: '4', height: 3 },
    ]) {
      await expectFormatError(archive(manifestJson(size)), /document size .* is invalid/);
    }
  });

  it('rejects invalid layer dimensions and positions', async () => {
    await expectFormatError(archive(layerOverrides({ width: 0 })), /invalid size/);
    await expectFormatError(archive(layerOverrides({ height: 9000 })), /invalid size/);
    await expectFormatError(archive(layerOverrides({ x: 0.5 })), /invalid position/);
    await expectFormatError(archive(layerOverrides({ y: '1' })), /invalid position/);
  });

  it('rejects invalid layer properties', async () => {
    await expectFormatError(archive(layerOverrides({ opacity: 1.5 })), /opacity 1\.5/);
    await expectFormatError(archive(layerOverrides({ opacity: null })), /opacity null/);
    await expectFormatError(archive(layerOverrides({ visible: 'yes' })), /visible "yes"/);
    await expectFormatError(archive(layerOverrides({ name: 3 })), /has no name/);
    await expectFormatError(archive(layerOverrides({ file: '' })), /does not name its image/);
  });

  it('rejects layer kinds and blend modes it does not support', async () => {
    await expectFormatError(
      archive(layerOverrides({ kind: 'text' })),
      /"text" layer, which this version of Pixelsoup doesn't support/,
    );
    await expectFormatError(
      archive(layerOverrides({ blendMode: 'multiply' })),
      /blend mode "multiply"/,
    );
  });

  it('rejects data that is not a zip archive', async () => {
    await expectFormatError(strToU8('hello, world'), /could not be read as a zip archive/);
    await expectFormatError(new Uint8Array(), /could not be read as a zip archive|no document/);
  });

  it('rejects an archive without document.json', async () => {
    await expectFormatError(zipSync({ 'readme.txt': strToU8('hi') }), /has no document\.json/);
  });

  it('rejects a document.json that is not a valid manifest', async () => {
    await expectFormatError(archive('{ nope'), /document\.json is not valid JSON/);
    await expectFormatError(archive('[]'), /not a JSON object/);
    await expectFormatError(archive(manifestJson({ layers: {} })), /has no layer list/);
    await expectFormatError(
      archive(manifestJson({ layers: [42] })),
      /Layer 1 .* not a JSON object/,
    );
  });
});

describe('parseManifest', () => {
  it('returns a typed manifest for valid input', () => {
    expect(parseManifest(manifestJson())).toEqual(manifestJson());
  });

  it('throws DocumentFormatError for non-objects', () => {
    expect(() => parseManifest(null)).toThrow(DocumentFormatError);
  });
});

describe('fake codec', () => {
  it('round-trips pixels', async () => {
    const pixels = createPixelBuffer(2, 1);
    setPixel(pixels, 1, 0, [1, 2, 3, 4]);
    expect(await fakePng.decode(await fakePng.encode(pixels))).toEqual(pixels);
  });
});
