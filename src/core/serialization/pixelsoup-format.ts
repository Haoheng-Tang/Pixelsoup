import type { Unzipped, Zippable } from 'fflate';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, createDocument, isValidImageSize } from '../document';
import type { BlendMode, Layer, LayerId } from '../layer';
import { assertNever, createRasterLayer, isBlendMode } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import type { PngCodec } from './png-codec';

// The .pixelsoup format: a zip archive holding `document.json` (a DocumentManifest) and
// one PNG per raster layer. The full specification is in docs/file-format.md.

/** Version of document.json this build writes, and the newest version it can read. */
export const FORMAT_VERSION = 1;

/** Archive path of the manifest. */
export const MANIFEST_PATH = 'document.json';

/** Layer IDs are path-safe, so a layer's image can live at `layers/<id>.png`. */
const LAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Contents of document.json. */
export interface DocumentManifest {
  readonly formatVersion: number;
  /** Canvas size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Bottom of the stack first, like `ImageDocument.layers`. */
  readonly layers: readonly LayerEntry[];
}

/** Properties every layer entry has, whatever its kind. */
interface LayerEntryBase {
  readonly id: LayerId;
  readonly name: string;
  readonly kind: Layer['kind'];
  readonly opacity: number;
  readonly visible: boolean;
  readonly blendMode: BlendMode;
}

export interface RasterLayerEntry extends LayerEntryBase {
  readonly kind: 'raster';
  /** Canvas-space position of the image's top-left pixel. */
  readonly x: number;
  readonly y: number;
  /** Size of the layer image; must match the PNG. */
  readonly width: number;
  readonly height: number;
  /** Archive path of the layer's PNG, e.g. "layers/layer-1.png". */
  readonly file: string;
}

/**
 * One entry per layer, discriminated by `kind` like `Layer`. New layer kinds (text,
 * adjustment) add members with their own fields; existing entries stay as they are.
 */
export type LayerEntry = RasterLayerEntry;

/** A .pixelsoup file that cannot be read: damaged, malformed, or from a newer version. */
export class DocumentFormatError extends Error {
  override name = 'DocumentFormatError';
}

export function createManifest(doc: ImageDocument): DocumentManifest {
  return {
    formatVersion: FORMAT_VERSION,
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map(layerEntry),
  };
}

function layerEntry(layer: Layer): LayerEntry {
  if (!LAYER_ID_PATTERN.test(layer.id)) throw new Error(`Layer ID is not path-safe: ${layer.id}`);
  switch (layer.kind) {
    case 'raster':
      return {
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        x: layer.x,
        y: layer.y,
        width: layer.pixels.width,
        height: layer.pixels.height,
        opacity: layer.opacity,
        visible: layer.visible,
        blendMode: layer.blendMode,
        file: `layers/${layer.id}.png`,
      };
    default:
      return assertNever(layer.kind);
  }
}

/**
 * Writes `doc` as .pixelsoup archive bytes.
 *
 * The layer list and properties are captured synchronously when this is called. Layer
 * pixel buffers are encoded afterwards, so they must not be modified until the returned
 * promise settles.
 */
export async function serializeDocument(
  doc: ImageDocument,
  png: PngCodec,
): Promise<Uint8Array<ArrayBuffer>> {
  const manifest = createManifest(doc);
  const images = doc.layers.map(layerImage);
  const files: Zippable = { [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [index, entry] of manifest.layers.entries()) {
    const pixels = images[index];
    if (!pixels) continue;
    // PNG data is already deflated; store it rather than compressing it again.
    files[entry.file] = [await png.encode(pixels), { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

function layerImage(layer: Layer): PixelBuffer | null {
  switch (layer.kind) {
    case 'raster':
      return layer.pixels;
    default:
      return assertNever(layer.kind);
  }
}

/**
 * Reads .pixelsoup archive bytes into a new document.
 * Throws `DocumentFormatError` with a user-readable message if the file can't be used.
 */
export async function deserializeDocument(
  bytes: Uint8Array,
  png: PngCodec,
): Promise<ImageDocument> {
  const manifestBytes = unzip(bytes, [MANIFEST_PATH])[MANIFEST_PATH];
  if (!manifestBytes) {
    throw new DocumentFormatError(`This is not a Pixelsoup file: it has no ${MANIFEST_PATH}.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new DocumentFormatError(`The file is damaged: ${MANIFEST_PATH} is not valid JSON.`);
  }
  const manifest = parseManifest(json);

  const files = unzip(
    bytes,
    manifest.layers.map((entry) => entry.file),
  );
  const doc = createDocument(manifest.width, manifest.height);
  for (const entry of manifest.layers) doc.layers.push(await readLayer(entry, files, png));
  doc.nextLayerNumber = firstFreeLayerNumber(doc.layers);
  return doc;
}

/** Extracts only the named entries, so unknown or unused entries are never inflated. */
function unzip(bytes: Uint8Array, names: readonly string[]): Unzipped {
  const wanted = new Set(names);
  try {
    return unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch {
    throw new DocumentFormatError(
      'This is not a Pixelsoup file, or it is damaged: it could not be read as a zip archive.',
    );
  }
}

async function readLayer(entry: LayerEntry, files: Unzipped, png: PngCodec): Promise<Layer> {
  switch (entry.kind) {
    case 'raster': {
      const label = `Layer "${entry.name}"`;
      const data = files[entry.file];
      if (!data) throw new DocumentFormatError(`${label}: its image ${entry.file} is missing.`);
      let pixels: PixelBuffer;
      try {
        pixels = await png.decode(data);
      } catch (error) {
        throw new DocumentFormatError(
          `${label}: its image ${entry.file} is not a readable PNG (${errorMessage(error)}).`,
        );
      }
      if (
        pixels.width !== entry.width ||
        pixels.height !== entry.height ||
        pixels.data.length !== pixels.width * pixels.height * 4
      ) {
        throw new DocumentFormatError(
          `${label}: its image ${entry.file} is ${pixels.width}×${pixels.height} pixels, ` +
            `but ${MANIFEST_PATH} says ${entry.width}×${entry.height}.`,
        );
      }
      return createRasterLayer({
        id: entry.id,
        name: entry.name,
        x: entry.x,
        y: entry.y,
        opacity: entry.opacity,
        visible: entry.visible,
        blendMode: entry.blendMode,
        pixels,
      });
    }
    default:
      return assertNever(entry.kind);
  }
}

/** One past the highest `layer-N` in use, so `createLayerId` continues the sequence. */
function firstFreeLayerNumber(layers: readonly Layer[]): number {
  let highest = 0;
  for (const { id } of layers) {
    const match = /^layer-(\d{1,15})$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new DocumentFormatError(message);
}

function show(value: unknown): string {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

/**
 * Validates parsed document.json. Unknown fields are ignored; unknown layer kinds, blend
 * modes and newer format versions are rejected rather than silently dropped.
 */
export function parseManifest(json: unknown): DocumentManifest {
  if (!isObject(json)) fail(`The file is damaged: ${MANIFEST_PATH} is not a JSON object.`);

  const version = json.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail(`The file is damaged: its formatVersion is ${show(version)}.`);
  }
  if (version > FORMAT_VERSION) {
    fail(
      `This file uses Pixelsoup format version ${version}, but this version of Pixelsoup ` +
        `can only open version ${FORMAT_VERSION}. Update Pixelsoup to open it.`,
    );
  }

  const { width, height } = json;
  if (typeof width !== 'number' || typeof height !== 'number' || !isValidImageSize(width, height)) {
    fail(
      `The document size ${show(width)}×${show(height)} is invalid: width and ` +
        `height must be whole numbers from 1 to ${MAX_IMAGE_SIZE}.`,
    );
  }

  const rawLayers = json.layers;
  if (!Array.isArray(rawLayers)) fail(`The file is damaged: ${MANIFEST_PATH} has no layer list.`);
  const ids = new Set<string>();
  const layers = rawLayers.map((raw: unknown, index) => parseLayerEntry(raw, index, ids));

  return { formatVersion: version, width, height, layers };
}

function parseLayerEntry(raw: unknown, index: number, ids: Set<string>): LayerEntry {
  const position = `Layer ${index + 1} (counting from the bottom)`;
  if (!isObject(raw)) fail(`${position} is not a JSON object.`);

  const { id, name } = raw;
  if (typeof id !== 'string' || !LAYER_ID_PATTERN.test(id)) {
    fail(`${position} has an invalid id ${show(id)}: use 1–64 letters, digits, - or _.`);
  }
  if (ids.has(id)) fail(`${position} has the id "${id}", which another layer already uses.`);
  ids.add(id);
  if (typeof name !== 'string') fail(`${position} has no name.`);

  const label = `Layer "${name}"`;
  const { kind, opacity, visible, blendMode } = raw;
  if (typeof opacity !== 'number' || !(opacity >= 0 && opacity <= 1)) {
    fail(`${label} has opacity ${show(opacity)}; it must be a number from 0 to 1.`);
  }
  if (typeof visible !== 'boolean') fail(`${label} has visible ${show(visible)}.`);
  if (!isBlendMode(blendMode)) {
    fail(`${label} uses blend mode ${show(blendMode)}, which this version doesn't support.`);
  }
  const common = { id, name, opacity, visible, blendMode };

  if (kind === 'raster') {
    const { x, y, width, height, file } = raw;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y)
    ) {
      fail(`${label} has an invalid position ${show(x)}, ${show(y)}.`);
    }
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !isValidImageSize(width, height)
    ) {
      fail(
        `${label} has an invalid size ${show(width)}×${show(height)}: width and ` +
          `height must be whole numbers from 1 to ${MAX_IMAGE_SIZE}.`,
      );
    }
    if (typeof file !== 'string' || file === '') fail(`${label} does not name its image file.`);
    return { ...common, kind, x, y, width, height, file };
  }
  return fail(
    `${label} is a ${show(kind)} layer, which this version of Pixelsoup doesn't support. ` +
      'The file may have been saved by a newer version.',
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
