import type { Rect, Selection } from '../../core';
import { loopLength, traceDownsampledOutline } from '../../core';

/**
 * Where the document sits on the canvas, in device pixels: device = origin + doc × scale,
 * and the canvas covers `width` × `height` from the origin.
 */
export interface DocumentPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Length of each dash (and gap) of the marching ants, in CSS pixels. */
export const ANT_DASH = 4;
/** Animation steps per dash period: the ants move one CSS pixel per step. */
export const ANT_PHASES = 2 * ANT_DASH;
/** Time between animation steps: about 12 a second. */
export const ANT_STEP_MS = 83;
/**
 * Loops shorter than this on screen, two dash periods in CSS pixels, are drawn solid: a
 * dash pattern on them would only blink.
 */
export const STATIC_LOOP_LENGTH = 2 * ANT_PHASES;
/** A wheel zoom retraces the outline this long after its last notch. */
export const ZOOM_SETTLE_MS = 100;
/** Outlines with at least this many corners are drawn once per phase and then blitted. */
export const PRERENDER_MIN_VERTICES = 2000;
/**
 * …as long as one phase covers at most this many device pixels (8 MB each, 64 MB for all
 * eight phases).
 */
export const PRERENDER_MAX_PIXELS = 1 << 21;
/** Outlines kept per selection, for zoom levels visited recently. */
const OUTLINE_CACHE_SIZE = 4;

/**
 * The ants' lines are one device pixel wide per CSS pixel, rounded; `nudge` centres odd
 * widths on a device pixel's middle so they stay crisp.
 */
export function lineWidthFor(dpr: number): { lineWidth: number; nudge: number } {
  const lineWidth = Math.max(1, Math.round(dpr));
  return { lineWidth, nudge: lineWidth % 2 === 1 ? 0.5 : 0 };
}

/**
 * Canvas pixels per outline cell at `zoom` (CSS pixels per canvas pixel): about one CSS
 * pixel when zoomed out, so the outline has no more detail than the screen can show. At
 * zooms from about 67 % up, it's 1: the selection's own pixels.
 */
export function outlineCell(zoom: number): number {
  return zoom >= 1 ? 1 : Math.max(1, Math.round(1 / zoom));
}

/** A selection's outline traced at one cell size, ready to draw. */
export interface AntsOutline {
  readonly selection: Selection;
  readonly cell: number;
  /** Closed loops in canvas coordinates, shortest first. */
  readonly loops: readonly (readonly number[])[];
  /** Each loop's length in canvas pixels, ascending. */
  readonly lengths: Float64Array;
  /** Corner points over all the loops. */
  readonly vertices: number;
  /** The loops' bounds in canvas coordinates; null with no loops. */
  readonly bounds: Rect | null;
}

/** The outline of `selection` at `cell` (`traceDownsampledOutline`), shortest loops first. */
export function traceAnts(selection: Selection, cell: number): AntsOutline {
  const traced = traceDownsampledOutline(selection, cell).loops;
  const measured = traced.map((loop) => ({ loop, length: loopLength(loop) }));
  measured.sort((a, b) => a.length - b.length);
  const loops = measured.map((m) => m.loop);
  const lengths = Float64Array.from(measured, (m) => m.length);
  let vertices = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const loop of loops) {
    vertices += loop.length / 2;
    for (let i = 0; i < loop.length; i += 2) {
      left = Math.min(left, loop[i]);
      right = Math.max(right, loop[i]);
      top = Math.min(top, loop[i + 1]);
      bottom = Math.max(bottom, loop[i + 1]);
    }
  }
  const bounds =
    loops.length > 0 ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  return { selection, cell, loops, lengths, vertices, bounds };
}

/**
 * How many of `outline`'s loops, the shortest, are too short on screen at `zoom` to animate
 * (under `STATIC_LOOP_LENGTH` CSS pixels).
 */
export function staticLoopCount(outline: AntsOutline, zoom: number): number {
  const { lengths } = outline;
  let low = 0;
  let high = lengths.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lengths[middle] * zoom < STATIC_LOOP_LENGTH) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The selection's outline for each zoom, traced once per selection and cell size. Panning
 * never retraces. While a wheel zoom is in progress (`zooming`), a cell size not yet traced
 * gets the most recent outline instead, and is traced once the zoom settles.
 */
export class AntsOutlineCache {
  private selection: Selection | null = null;
  /** Most recently used first. */
  private entries: AntsOutline[] = [];

  constructor(private readonly trace: typeof traceAnts = traceAnts) {}

  get(selection: Selection, zoom: number, zooming: boolean): AntsOutline {
    if (selection !== this.selection) {
      this.selection = selection;
      this.entries = [];
    }
    const cell = outlineCell(zoom);
    const index = this.entries.findIndex((entry) => entry.cell === cell);
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1);
      this.entries.unshift(entry);
      return entry;
    }
    if (zooming && this.entries.length > 0) return this.entries[0];
    const outline = this.trace(selection, cell);
    this.entries.unshift(outline);
    this.entries.length = Math.min(this.entries.length, OUTLINE_CACHE_SIZE);
    return outline;
  }

  clear(): void {
    this.selection = null;
    this.entries = [];
  }
}

/** An outline's edges, laid out for the GPU: one instance per edge. */
export interface AntSegments {
  readonly outline: AntsOutline;
  readonly count: number;
  /** x0, y0, x1, y1 for each edge, in canvas coordinates. */
  readonly ends: Float32Array;
  /** How far round its loop each edge starts, in canvas pixels. */
  readonly starts: Float64Array;
  /** The length of each edge's loop, in canvas pixels. */
  readonly loopLengths: Float64Array;
}

/** `outline`'s edges in loop order, leaving out any of zero length. */
export function antSegments(outline: AntsOutline): AntSegments {
  const { loops, lengths } = outline;
  const capacity = outline.vertices;
  const ends = new Float32Array(capacity * 4);
  const starts = new Float64Array(capacity);
  const loopLengths = new Float64Array(capacity);
  let count = 0;
  for (let l = 0; l < loops.length; l++) {
    const loop = loops[l];
    let along = 0;
    for (let i = 0; i < loop.length; i += 2) {
      const j = i + 2 < loop.length ? i + 2 : 0;
      const length = Math.abs(loop[j] - loop[i]) + Math.abs(loop[j + 1] - loop[i + 1]);
      if (length === 0) continue;
      ends[count * 4] = loop[i];
      ends[count * 4 + 1] = loop[i + 1];
      ends[count * 4 + 2] = loop[j];
      ends[count * 4 + 3] = loop[j + 1];
      starts[count] = along;
      loopLengths[count] = lengths[l];
      along += length;
      count++;
    }
  }
  return {
    outline,
    count,
    ends: ends.subarray(0, count * 4),
    starts: starts.subarray(0, count),
    loopLengths: loopLengths.subarray(0, count),
  };
}

/**
 * For each edge, where the dash pattern stands at its start (device pixels from the start
 * of a dash, 0 to one period) and 1 if its loop is too short on screen to animate, else 0;
 * at `scale` device pixels per canvas pixel and `zoom` CSS pixels per canvas pixel. Worked
 * out in double precision, so the GPU only adds the short distance along each edge.
 */
export function antDashes(
  segments: AntSegments,
  scale: number,
  zoom: number,
  dpr: number,
  out: Float32Array = new Float32Array(segments.count * 2),
): Float32Array {
  const period = ANT_PHASES * dpr;
  const { starts, loopLengths } = segments;
  for (let i = 0; i < segments.count; i++) {
    out[i * 2] = (starts[i] * scale) % period;
    out[i * 2 + 1] = loopLengths[i] * zoom < STATIC_LOOP_LENGTH ? 1 : 0;
  }
  return out;
}

/** An area of the overlay canvas in whole device pixels. */
export interface DeviceRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where `bounds` (canvas coordinates) lands on an overlay `width` × `height` device pixels,
 * grown by `pad` device pixels on each side for the lines and cut to the overlay; null when
 * none of it is on the overlay.
 */
export function deviceRegion(
  bounds: Rect,
  placement: DocumentPlacement,
  pad: number,
  width: number,
  height: number,
): DeviceRegion | null {
  const left = Math.max(0, Math.floor(placement.x + bounds.x * placement.scaleX) - pad);
  const top = Math.max(0, Math.floor(placement.y + bounds.y * placement.scaleY) - pad);
  const right = Math.min(
    width,
    Math.ceil(placement.x + (bounds.x + bounds.width) * placement.scaleX) + pad,
  );
  const bottom = Math.min(
    height,
    Math.ceil(placement.y + (bounds.y + bounds.height) * placement.scaleY) + pad,
  );
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Everything a set of prerendered ant phases depends on. */
export interface AntPhaseKey {
  readonly outline: AntsOutline;
  /** Loops drawn solid (`staticLoopCount`). */
  readonly staticCount: number;
  readonly placement: DocumentPlacement;
  readonly dpr: number;
  /** The part of the overlay each phase covers. */
  readonly region: DeviceRegion;
}

function sameKey(a: AntPhaseKey, b: AntPhaseKey): boolean {
  return (
    a.outline === b.outline &&
    a.staticCount === b.staticCount &&
    a.dpr === b.dpr &&
    a.placement.x === b.placement.x &&
    a.placement.y === b.placement.y &&
    a.placement.scaleX === b.placement.scaleX &&
    a.placement.scaleY === b.placement.scaleY &&
    a.region.x === b.region.x &&
    a.region.y === b.region.y &&
    a.region.width === b.region.width &&
    a.region.height === b.region.height
  );
}

/**
 * The ants drawn once per animation phase, so each step after the first cycle is a blit.
 * Images render as their phase is first needed. Any change to the key (a pan, a zoom, a new
 * selection or outline) invalidates them all; their images are handed back to `render` to
 * be reused.
 */
export class AntPhaseCache<T> {
  private key: AntPhaseKey | null = null;
  private images: (T | undefined)[] = [];
  private spares: T[] = [];
  private renders = 0;

  constructor(private readonly render: (key: AntPhaseKey, phase: number, reuse: T | null) => T) {}

  /** Phases rendered so far, for tests. */
  get rendered(): number {
    return this.renders;
  }

  /** The image of `phase` (0 to `ANT_PHASES` − 1) for `key`. */
  get(key: AntPhaseKey, phase: number): T {
    if (this.key === null || !sameKey(this.key, key)) {
      this.invalidate();
      this.key = key;
    }
    let image = this.images[phase];
    if (image === undefined) {
      image = this.render(key, phase, this.spares.pop() ?? null);
      this.images[phase] = image;
      this.renders++;
    }
    return image;
  }

  /** Forgets the phases, keeping their images to reuse. */
  invalidate(): void {
    for (const image of this.images) if (image !== undefined) this.spares.push(image);
    this.images = [];
    this.key = null;
  }

  /** Forgets the phases and their images. */
  release(): void {
    this.images = [];
    this.spares = [];
    this.key = null;
  }
}
