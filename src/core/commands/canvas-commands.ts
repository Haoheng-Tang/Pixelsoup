import type { ImageDocument } from '../document';
import { documentBounds, isValidImageSize } from '../document';
import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { Layer, RasterLayer } from '../layer';
import { assertNever, rasterBounds, toLayerSpace } from '../layer';
import { copyPixels, createPixelBuffer, pastePixels } from '../pixel-buffer';
import { PixelSnapshot } from '../pixel-snapshot';
import type { Selection } from '../selection';
import { place } from './layer-growth';

export interface ResizeCanvasOptions {
  /** The undo label: "Canvas Size" unless given. */
  readonly label?: string;
  /**
   * Trim every layer to the new canvas ("Delete cropped pixels"), keeping what it cut
   * only for undo. Off by default: layers keep every pixel, on the canvas or not.
   */
  readonly trim?: boolean;
}

/** The canvas as it was, for undo. */
interface CanvasState {
  readonly width: number;
  readonly height: number;
  readonly selection: Selection | null;
}

/** A layer trimmed to the canvas, and what undo needs to give it back its pixels. */
interface Trim {
  readonly layer: RasterLayer;
  /** Its placement and size before trimming, after moving with the canvas. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The part it kept, in its old buffer's coordinates; null if none was on the canvas. */
  readonly kept: Rect | null;
  /** The pixels it lost around `kept` (all of them if it kept none). */
  readonly cut: readonly PixelSnapshot[];
}

/**
 * Gives the canvas a new size and moves every layer by (offsetX, offsetY): what was at
 * (x, y) on the old canvas is at (x + offsetX, y + offsetY) on the new one. Layers keep
 * all their pixels, on the canvas or past its edges, so undo needs no pixel copies;
 * with `trim` they are cut to the canvas instead and keep what they lost for undo. The
 * selection moves with the layers and is cut to the new canvas, or cleared if nothing of
 * it is left.
 *
 * Crop and Canvas Size are both this command: a crop to `area` is a canvas the size of
 * `area`, moved by (−area.x, −area.y).
 */
export class ResizeCanvasCommand implements Command {
  readonly label: string;
  readonly trim: boolean;
  private before: CanvasState | null = null;
  private trims: readonly Trim[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly offsetX: number,
    readonly offsetY: number,
    options: ResizeCanvasOptions = {},
  ) {
    if (!isValidImageSize(width, height)) {
      throw new RangeError(`Invalid canvas size ${width}x${height}`);
    }
    if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) {
      throw new RangeError(`Layers move by whole pixels, not ${offsetX}, ${offsetY}`);
    }
    this.label = options.label ?? 'Canvas Size';
    this.trim = options.trim ?? false;
  }

  apply(doc: ImageDocument): DocumentChange {
    const before: CanvasState = { width: doc.width, height: doc.height, selection: doc.selection };
    this.before = before;
    doc.width = this.width;
    doc.height = this.height;
    for (const layer of doc.layers) moveLayer(layer, this.offsetX, this.offsetY);
    const moved = before.selection?.resizeCanvas(
      this.width,
      this.height,
      this.offsetX,
      this.offsetY,
    );
    doc.selection = moved && !moved.isEmpty ? moved : null;
    this.trims = this.trim ? trimLayers(doc) : [];
    return this.change(doc, before);
  }

  revert(doc: ImageDocument): DocumentChange {
    const before = this.before;
    if (!before) throw new Error('ResizeCanvasCommand was not applied');
    const after: CanvasState = { width: doc.width, height: doc.height, selection: doc.selection };
    for (const trim of this.trims) untrim(trim);
    for (const layer of doc.layers) moveLayer(layer, -this.offsetX, -this.offsetY);
    doc.width = before.width;
    doc.height = before.height;
    doc.selection = before.selection;
    return this.change(doc, after);
  }

  /** The change from `other` to the document's current canvas. */
  private change(doc: ImageDocument, other: CanvasState): DocumentChange {
    const canvas = documentBounds(doc);
    const resized = doc.width !== other.width || doc.height !== other.height;
    const selectionChanged = doc.selection !== null || other.selection !== null;
    return {
      dirty: canvas,
      ...(resized && { resized }),
      ...(selectionChanged && { selectionDirty: canvas }),
      ...(this.trims.length > 0 && {
        layerPixels: this.trims.map((trim) => ({ layerId: trim.layer.id, rect: null })),
      }),
    };
  }
}

function moveLayer(layer: Layer, dx: number, dy: number): void {
  switch (layer.kind) {
    case 'raster':
      layer.x += dx;
      layer.y += dy;
      return;
    default:
      assertNever(layer.kind);
  }
}

/** Cuts every layer to the canvas, returning what each one that lost pixels lost. */
function trimLayers(doc: ImageDocument): Trim[] {
  const trims: Trim[] = [];
  for (const layer of doc.layers) {
    switch (layer.kind) {
      case 'raster': {
        const trim = trimRaster(doc, layer);
        if (trim) trims.push(trim);
        break;
      }
      default:
        assertNever(layer.kind);
    }
  }
  return trims;
}

/**
 * Cuts the layer to the canvas, or returns null if it lies wholly on it. A layer left with
 * nothing becomes a transparent layer the size of the canvas, as layers never have no pixels.
 */
function trimRaster(doc: ImageDocument, layer: RasterLayer): Trim | null {
  const bounds = rasterBounds(layer);
  const keep = intersectRects(bounds, documentBounds(doc));
  if (keep && keep.width === bounds.width && keep.height === bounds.height) return null;
  const { pixels } = layer;
  const whole: Rect = { x: 0, y: 0, width: pixels.width, height: pixels.height };
  const kept = keep && toLayerSpace(layer, keep);
  const cut = (kept ? bandsAround(whole, kept) : [whole]).map((band) =>
    PixelSnapshot.capture(pixels, band),
  );
  const trim: Trim = { layer, x: layer.x, y: layer.y, ...sizeOf(whole), kept, cut };
  if (keep && kept) place(layer, { pixels: copyPixels(pixels, kept), x: keep.x, y: keep.y });
  else place(layer, { pixels: createPixelBuffer(doc.width, doc.height), x: 0, y: 0 });
  return trim;
}

function sizeOf(area: Rect): { width: number; height: number } {
  return { width: area.width, height: area.height };
}

/** The non-empty parts of `whole` outside `inner`, which lies within it: up to four bands. */
function bandsAround(whole: Rect, inner: Rect): Rect[] {
  const right = inner.x + inner.width;
  const bottom = inner.y + inner.height;
  const bands: Rect[] = [
    { x: 0, y: 0, width: whole.width, height: inner.y },
    { x: 0, y: bottom, width: whole.width, height: whole.height - bottom },
    { x: 0, y: inner.y, width: inner.x, height: inner.height },
    { x: right, y: inner.y, width: whole.width - right, height: inner.height },
  ];
  return bands.filter((band) => band.width > 0 && band.height > 0);
}

/** Puts back the pixels a trim cut, around those the layer kept. */
function untrim(trim: Trim): void {
  const pixels = createPixelBuffer(trim.width, trim.height);
  if (trim.kept) pastePixels(pixels, trim.layer.pixels, trim.kept.x, trim.kept.y);
  for (const part of trim.cut) part.restore(pixels);
  place(trim.layer, { pixels, x: trim.x, y: trim.y });
}

/**
 * Resizes the canvas as `ResizeCanvasCommand` does, or returns null if nothing would
 * change: the same size, no offset, and (with `trim`) no layer past the canvas's edges.
 */
export function resizeCanvasCommand(
  doc: ImageDocument,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  options: ResizeCanvasOptions = {},
): ResizeCanvasCommand | null {
  const unchanged = width === doc.width && height === doc.height && offsetX === 0 && offsetY === 0;
  if (unchanged && !(options.trim && doc.layers.some((layer) => pastCanvas(doc, layer)))) {
    return null;
  }
  return new ResizeCanvasCommand(width, height, offsetX, offsetY, options);
}

function pastCanvas(doc: ImageDocument, layer: Layer): boolean {
  switch (layer.kind) {
    case 'raster': {
      const bounds = rasterBounds(layer);
      const onCanvas = intersectRects(bounds, documentBounds(doc));
      return !onCanvas || onCanvas.width !== bounds.width || onCanvas.height !== bounds.height;
    }
    default:
      return assertNever(layer.kind);
  }
}

/**
 * Crops the canvas to `area` (canvas coordinates, whole pixels), which may reach past the
 * canvas to enlarge it with transparent space. Null if nothing would change.
 */
export function cropCommand(
  doc: ImageDocument,
  area: Rect,
  options: ResizeCanvasOptions = {},
): ResizeCanvasCommand | null {
  return resizeCanvasCommand(doc, area.width, area.height, -area.x, -area.y, {
    ...options,
    label: options.label ?? 'Crop',
  });
}

/** Which side of the canvas Canvas Size keeps the image against, along one axis. */
export type Anchor = 'start' | 'center' | 'end';

/**
 * The offset that keeps the image anchored when the canvas changes from `from` to `to`
 * pixels along one axis. Centring truncates toward zero, so growing the canvas and then
 * shrinking it back by the same amount puts the image back where it was.
 */
export function anchorOffset(from: number, to: number, anchor: Anchor): number {
  switch (anchor) {
    case 'start':
      return 0;
    case 'center':
      return Math.trunc((to - from) / 2) || 0; // never −0
    case 'end':
      return to - from;
    default:
      return assertNever(anchor);
  }
}

/** Canvas Size: a new size with the image anchored, or null if the size is unchanged. */
export function canvasSizeCommand(
  doc: ImageDocument,
  width: number,
  height: number,
  horizontal: Anchor,
  vertical: Anchor,
): ResizeCanvasCommand | null {
  const offsetX = anchorOffset(doc.width, width, horizontal);
  const offsetY = anchorOffset(doc.height, height, vertical);
  return resizeCanvasCommand(doc, width, height, offsetX, offsetY);
}
