import type { PixelBuffer, Point, Selection } from '../../core';
import { CanvasPyramid, drawScale } from '../render/canvas-pyramid';
import type {
  BrushOverlay,
  CropOverlay,
  LassoOverlay,
  ShapeOverlay,
  ToolOverlay,
  TransformOverlay,
} from '../tools/tool';
import type { AntPhaseKey, AntSegments, AntsOutline, DocumentPlacement } from './ants';
import {
  ANT_DASH,
  ANT_PHASES,
  AntPhaseCache,
  AntsOutlineCache,
  PRERENDER_MAX_PIXELS,
  PRERENDER_MIN_VERTICES,
  antSegments,
  deviceRegion,
  lineWidthFor,
  staticLoopCount,
} from './ants';
import { GlAnts } from './ants-gl';
import { createCheckerPattern } from './checkerboard';

/** Everything the overlay shows in one frame. */
export interface OverlayFrame {
  readonly selection: Selection | null;
  /** False hides the selection's ants (View → Extras); the tool's preview still shows. */
  readonly showSelection: boolean;
  readonly preview: ToolOverlay | null;
  /**
   * The layers above the one a transform previews, which the composite leaves out with
   * it: drawn over the preview, at 1 image pixel = 1 document pixel.
   */
  readonly above: CanvasPyramid | null;
  /** Null when the document isn't visible. */
  readonly placement: DocumentPlacement | null;
  readonly dpr: number;
  /** CSS pixels per canvas pixel. */
  readonly zoom: number;
  /** Animation step, 0 to `ANT_PHASES` − 1: the ants move one CSS pixel per step. */
  readonly phase: number;
  /** A wheel zoom is in progress: an outline traced for an earlier zoom will do. */
  readonly zooming: boolean;
  /** A pan or wheel zoom is in progress: the 2D path draws the ants directly. */
  readonly viewChanging: boolean;
}

/** The ants' colours: light under the dashes, and the dashes and static outlines dark. */
const ANT_LIGHT = '#ffffff';
const ANT_DARK = '#000000';
/** Brushes narrower than this on screen, in CSS pixels, show a crosshair instead. */
const MIN_BRUSH_OUTLINE = 4;
/** The crosshair's arms run from this far from its centre, in CSS pixels… */
const CROSSHAIR_GAP = 2;
/** …to this far. */
const CROSSHAIR_ARM = 7;
/** The dark halo that keeps cursors visible on light pixels, in line widths. */
const HALO_WIDTH = 3;
/** The crop box's and the transform box's square handles, in CSS pixels across. */
const BOX_HANDLE = 7;
/**
 * The ring that marks where a click closes a lasso, and the pivot of a transform, in CSS
 * pixels across.
 */
const RING = 9;

/** An outline's loops as paths: those too short to animate, and those that march. */
interface AntPaths {
  readonly outline: AntsOutline;
  readonly staticCount: number;
  readonly still: Path2D | null;
  readonly moving: Path2D | null;
}

/** A path in canvas coordinates through `loops[from]` to `loops[to - 1]`; null if none. */
function loopsPath(loops: readonly (readonly number[])[], from: number, to: number): Path2D | null {
  if (from >= to) return null;
  const path = new Path2D();
  for (let l = from; l < to; l++) {
    const loop = loops[l];
    path.moveTo(loop[0], loop[1]);
    for (let i = 2; i < loop.length; i += 2) path.lineTo(loop[i], loop[i + 1]);
    path.closePath();
  }
  return path;
}

/**
 * Strokes the selection's ants into `ctx`, whose top-left is the overlay's device pixel
 * (`originX`, `originY`): white under black dashes for the loops that march, solid black
 * for those too short to.
 */
function strokeAntPaths(
  ctx: CanvasRenderingContext2D,
  paths: AntPaths,
  placement: DocumentPlacement,
  dpr: number,
  phase: number,
  originX: number,
  originY: number,
): void {
  const { lineWidth, nudge } = lineWidthFor(dpr);
  const scale = (placement.scaleX + placement.scaleY) / 2;
  const { scaleX, scaleY } = placement;
  ctx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    placement.x - originX + nudge,
    placement.y - originY + nudge,
  );
  // In canvas units, so screen sizes are divided by the scale.
  ctx.lineWidth = lineWidth / scale;
  ctx.setLineDash([]);
  if (paths.moving) {
    ctx.strokeStyle = ANT_LIGHT;
    ctx.stroke(paths.moving);
  }
  if (paths.still) {
    ctx.strokeStyle = ANT_DARK;
    ctx.stroke(paths.still);
  }
  if (paths.moving) {
    const dash = (ANT_DASH * dpr) / scale;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = (-(phase % ANT_PHASES) * dpr) / scale;
    ctx.strokeStyle = ANT_DARK;
    ctx.stroke(paths.moving);
  }
}

function previewPath({ shape, rect }: ShapeOverlay): Path2D {
  const path = new Path2D();
  if (shape === 'rect') {
    path.rect(rect.x, rect.y, rect.width, rect.height);
  } else {
    const rx = Math.abs(rect.width) / 2;
    const ry = Math.abs(rect.height) / 2;
    path.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rx, ry, 0, 0, 2 * Math.PI);
  }
  return path;
}

/** A lasso's points joined in order, then the rubber band; left open. */
function lassoPath({ points, next }: LassoOverlay): Path2D {
  const path = new Path2D();
  let started = false;
  for (const { x, y } of next ? [...points, next] : points) {
    if (started) path.lineTo(x, y);
    else path.moveTo(x, y);
    started = true;
  }
  return path;
}

/**
 * Draws the selection's marching ants, any shape or lasso the active tool is drawing, the
 * crop box, a painting tool's brush outline, and a layer under Free Transform with its box,
 * on a transparent canvas stacked above the composite.
 *
 * The selection's outline is traced once per selection and zoom bucket (`AntsOutlineCache`:
 * at screen resolution when zoomed out). With WebGL 2 the ants go on a canvas of their own
 * just below this one (`GlAnts`), where any frame is one draw call. Without it, each frame
 * strokes the outline here through the current pan and zoom with the step's dash offset,
 * and outlines with many corners are drawn once per phase and blitted from then on, until
 * the view or the selection changes. Either way loops too short on screen to animate are
 * drawn solid, and lines are one device pixel per CSS pixel at every zoom.
 */
export class SelectionOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly outlines = new AntsOutlineCache();
  private paths: AntPaths | null = null;
  /** The outline the last draw showed. */
  private drawnOutline: AntsOutline | null = null;
  private readonly phases = new AntPhaseCache<HTMLCanvasElement>((key, phase, reuse) =>
    this.renderPhase(key, phase, reuse),
  );
  /** The WebGL ants, made when first needed; null where WebGL 2 isn't available. */
  private glAnts: GlAnts | null | undefined;
  private segments: AntSegments | null = null;
  /** Nothing is drawn on this canvas. */
  private blank = true;
  /** Brush outline colours, from the `--cursor-line` and `--cursor-halo` tokens. */
  private readonly cursorLine: string;
  private readonly cursorHalo: string;
  /** Crop box colours, from the `--crop-*` tokens. */
  private readonly cropShade: string;
  private readonly cropGrid: string;
  private readonly cropGridHalo: string;
  private checker: CanvasPattern | string | null = null;
  private checkerDpr = 0;
  /** The pixels of a layer under Free Transform, on a canvas to draw them from. */
  private transformSource: { pixels: PixelBuffer; pyramid: CanvasPyramid } | null = null;
  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
    container.appendChild(this.canvas);
    const style = getComputedStyle(container);
    const token = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    this.cursorLine = token('--cursor-line', '#fff');
    this.cursorHalo = token('--cursor-halo', 'rgb(0 0 0 / 55%)');
    this.cropShade = token('--crop-shade', 'rgb(0 0 0 / 50%)');
    this.cropGrid = token('--crop-grid', 'rgb(255 255 255 / 75%)');
    this.cropGridHalo = token('--crop-grid-halo', 'rgb(0 0 0 / 25%)');
  }

  /** Matches the main canvas's backing size in device pixels. */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.blank = true;
    this.glAnts?.resize(width, height);
  }

  /** Removes the overlay's canvases. */
  dispose(): void {
    this.glAnts?.dispose();
    this.glAnts = null;
    this.canvas.remove();
  }

  /** Redraws the overlay. */
  draw(frame: OverlayFrame): void {
    const { selection, preview, placement, dpr, phase } = frame;
    const brush = preview?.shape === 'brush' ? preview : null;
    const crop = preview?.shape === 'crop' ? preview : null;
    const shape = preview?.shape === 'rect' || preview?.shape === 'ellipse' ? preview : null;
    const lasso = preview?.shape === 'lasso' ? preview : null;
    const transform = preview?.shape === 'transform' ? preview : null;
    if (!transform) this.transformSource = null;
    // A transform's box shows instead of the selection.
    const hidesSelection = shape?.hidesSelection ?? lasso?.hidesSelection ?? transform !== null;
    const ants = frame.showSelection && !hidesSelection && placement ? selection : null;
    if (!selection) this.releaseOutlines();
    const onGpu = ants !== null && placement !== null && this.drawAntsGl(ants, frame, placement);
    if (!onGpu) this.glAnts?.clear();
    if (!ants || onGpu) this.phases.release();

    const ctx = this.context;
    const antsHere = ants !== null && !onGpu;
    if (!placement || !(antsHere || shape || lasso || crop || brush || transform)) {
      if (!this.blank) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.blank = true;
      }
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.blank = false;
    if (transform) this.drawTransformed(transform, frame.above, placement, frame.zoom);
    if (antsHere) this.drawAnts(ants, frame, placement);

    const { lineWidth, nudge } = lineWidthFor(dpr);
    const scale = (placement.scaleX + placement.scaleY) / 2;
    ctx.setTransform(
      placement.scaleX,
      0,
      0,
      placement.scaleY,
      placement.x + nudge,
      placement.y + nudge,
    );
    // Everything below is in document units, so divide screen sizes by the scale.
    ctx.lineWidth = lineWidth / scale;
    const dash = (ANT_DASH * dpr) / scale;
    const offset = (-(phase % ANT_PHASES) * dpr) / scale;

    if (shape) this.strokeAnts(previewPath(shape), dash, offset);
    if (lasso) {
      this.strokeAnts(lassoPath(lasso), dash, offset);
      const first = lasso.points[0];
      if (lasso.closing && first) this.drawRing(first, placement, dpr, lineWidth);
    }
    if (crop) this.drawCrop(crop, placement, dpr, lineWidth, nudge);
    if (transform) this.drawTransformBox(transform, placement, dpr, lineWidth, nudge);
    if (brush) this.drawBrush(brush, placement, dpr, lineWidth, nudge);
  }

  /**
   * The selection's ants on the WebGL canvas, if there is one; false to draw them here
   * instead (no WebGL 2, or its context is lost).
   */
  private drawAntsGl(
    selection: Selection,
    frame: OverlayFrame,
    placement: DocumentPlacement,
  ): boolean {
    const gl = this.glRenderer();
    if (!gl) return false;
    const outline = this.outlines.get(selection, frame.zoom, frame.zooming);
    if (this.segments?.outline !== outline) this.segments = antSegments(outline);
    const { dpr, zoom, phase } = frame;
    return gl.draw({ segments: this.segments, placement, dpr, zoom, phase });
  }

  private glRenderer(): GlAnts | null {
    if (this.glAnts === undefined) {
      const canvas = document.createElement('canvas');
      canvas.className = 'viewport-overlay';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
      this.glAnts = GlAnts.create(canvas);
      if (this.glAnts) this.container.insertBefore(canvas, this.canvas);
    }
    return this.glAnts;
  }

  /**
   * The selection's ants: from this phase's prerendered image when the outline is complex
   * enough to be worth it and the view is still, else stroked straight onto the overlay.
   */
  private drawAnts(selection: Selection, frame: OverlayFrame, placement: DocumentPlacement): void {
    const outline = this.outlines.get(selection, frame.zoom, frame.zooming);
    if (!outline.bounds) return;
    const { lineWidth } = lineWidthFor(frame.dpr);
    const { width, height } = this.canvas;
    const region = deviceRegion(outline.bounds, placement, lineWidth + 1, width, height);
    if (!region) return;
    const paths = this.antPaths(outline, staticLoopCount(outline, frame.zoom));
    const ctx = this.context;
    const prerender =
      outline.vertices >= PRERENDER_MIN_VERTICES &&
      region.width * region.height <= PRERENDER_MAX_PIXELS;
    // An outline may last a single frame (a floating selection on the move), so it's only
    // prerendered from its second draw on.
    const fresh = outline !== this.drawnOutline;
    this.drawnOutline = outline;
    if (!prerender || frame.viewChanging || fresh) {
      // Keep the images to draw the phases into again once the view and outline settle.
      if (prerender) this.phases.invalidate();
      else this.phases.release();
      strokeAntPaths(ctx, paths, placement, frame.dpr, frame.phase, 0, 0);
      return;
    }
    const key = { outline, staticCount: paths.staticCount, placement, dpr: frame.dpr, region };
    const image = this.phases.get(key, frame.phase % ANT_PHASES);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const { x, y, width: w, height: h } = region;
    ctx.drawImage(image, 0, 0, w, h, x, y, w, h);
  }

  private antPaths(outline: AntsOutline, staticCount: number): AntPaths {
    const cached = this.paths;
    if (cached?.outline === outline && cached.staticCount === staticCount) return cached;
    const { loops } = outline;
    const still = loopsPath(loops, 0, staticCount);
    const moving = loopsPath(loops, staticCount, loops.length);
    this.paths = { outline, staticCount, still, moving };
    return this.paths;
  }

  /** One phase of the ants on a canvas covering `key.region`, reusing `reuse` if given. */
  private renderPhase(
    key: AntPhaseKey,
    phase: number,
    reuse: HTMLCanvasElement | null,
  ): HTMLCanvasElement {
    const canvas = reuse ?? document.createElement('canvas');
    const { region } = key;
    if (canvas.width !== region.width || canvas.height !== region.height) {
      canvas.width = region.width;
      canvas.height = region.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, region.width, region.height);
    const paths = this.antPaths(key.outline, key.staticCount);
    strokeAntPaths(ctx, paths, key.placement, key.dpr, phase, region.x, region.y);
    return canvas;
  }

  private releaseOutlines(): void {
    this.outlines.clear();
    this.paths = null;
    this.segments = null;
    this.drawnOutline = null;
  }

  private checkerPattern(dpr: number): CanvasPattern | string {
    if (this.checker === null || this.checkerDpr !== dpr) {
      this.checker = createCheckerPattern(this.context, dpr);
      this.checkerDpr = dpr;
    }
    return this.checker;
  }

  private strokeAnts(path: Path2D, dash: number, offset: number): void {
    const ctx = this.context;
    ctx.setLineDash([]);
    ctx.strokeStyle = ANT_LIGHT;
    ctx.stroke(path);
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = offset;
    ctx.strokeStyle = ANT_DARK;
    ctx.stroke(path);
  }

  /**
   * A ring around a point, the same size at every zoom: a lasso's first point, where a
   * click would close it, or a transform's pivot. Drawn in device pixels.
   */
  private drawRing(
    point: Point,
    placement: DocumentPlacement,
    dpr: number,
    lineWidth: number,
  ): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    const path = new Path2D();
    const x = placement.x + point.x * placement.scaleX;
    const y = placement.y + point.y * placement.scaleY;
    path.arc(x, y, (RING * dpr) / 2, 0, 2 * Math.PI);
    ctx.lineWidth = lineWidth * HALO_WIDTH;
    ctx.strokeStyle = this.cursorHalo;
    ctx.stroke(path);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = this.cursorLine;
    ctx.stroke(path);
  }

  /**
   * The brush's outline at its size in document pixels, so it scales with the zoom; or a
   * crosshair when the brush would be too small on screen to see. Drawn in device pixels.
   */
  private drawBrush(
    brush: BrushOverlay,
    placement: DocumentPlacement,
    dpr: number,
    lineWidth: number,
    nudge: number,
  ): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    const x = placement.x + brush.x * placement.scaleX;
    const y = placement.y + brush.y * placement.scaleY;
    const rx = (brush.diameter * placement.scaleX) / 2;
    const ry = (brush.diameter * placement.scaleY) / 2;
    const path = new Path2D();
    if (2 * Math.max(rx, ry) >= MIN_BRUSH_OUTLINE * dpr) {
      path.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
    } else {
      // On the device pixel grid, so that the lines stay crisp.
      const cx = Math.round(x) + nudge;
      const cy = Math.round(y) + nudge;
      const gap = Math.round(CROSSHAIR_GAP * dpr);
      const arm = Math.round(CROSSHAIR_ARM * dpr);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        path.moveTo(cx + dx * gap, cy + dy * gap);
        path.lineTo(cx + dx * arm, cy + dy * arm);
      }
    }
    ctx.lineWidth = lineWidth * HALO_WIDTH;
    ctx.strokeStyle = this.cursorHalo;
    ctx.stroke(path);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = this.cursorLine;
    ctx.stroke(path);
  }

  /**
   * The crop box: everything outside it shaded (unless it's the whole canvas), the area it
   * adds beyond the canvas shown as transparent, a rule-of-thirds grid while it's being
   * adjusted, its outline and eight square handles. Drawn in device pixels, with the box's
   * edges on the device pixel grid.
   */
  private drawCrop(
    crop: CropOverlay,
    placement: DocumentPlacement,
    dpr: number,
    lineWidth: number,
    nudge: number,
  ): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    const { rect } = crop;
    const left = Math.round(placement.x + rect.x * placement.scaleX);
    const top = Math.round(placement.y + rect.y * placement.scaleY);
    const right = Math.round(placement.x + (rect.x + rect.width) * placement.scaleX);
    const bottom = Math.round(placement.y + (rect.y + rect.height) * placement.scaleY);
    const width = right - left;
    const height = bottom - top;

    // New area beyond the canvas: the box minus its overlap with the canvas.
    const canvasRight = placement.x + placement.width;
    const canvasBottom = placement.y + placement.height;
    if (left < placement.x || top < placement.y || right > canvasRight || bottom > canvasBottom) {
      const added = new Path2D();
      added.rect(left, top, width, height);
      const overlapLeft = Math.max(left, placement.x);
      const overlapTop = Math.max(top, placement.y);
      const overlapRight = Math.min(right, canvasRight);
      const overlapBottom = Math.min(bottom, canvasBottom);
      if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
        added.rect(overlapLeft, overlapTop, overlapRight - overlapLeft, overlapBottom - overlapTop);
      }
      const checker = this.checkerPattern(dpr);
      // Anchored like the composite's checkerboard, so the two meet seamlessly.
      if (typeof checker !== 'string') {
        checker.setTransform(new DOMMatrix([1, 0, 0, 1, placement.x, placement.y]));
      }
      ctx.fillStyle = checker;
      ctx.fill(added, 'evenodd');
    }

    if (crop.shade) {
      const shade = new Path2D();
      shade.rect(0, 0, this.canvas.width, this.canvas.height);
      shade.rect(left, top, width, height);
      ctx.fillStyle = this.cropShade;
      ctx.fill(shade, 'evenodd');
    }

    if (crop.grid) {
      const grid = new Path2D();
      for (const third of [1, 2]) {
        const x = Math.round(left + (width * third) / 3) + nudge;
        const y = Math.round(top + (height * third) / 3) + nudge;
        grid.moveTo(x, top);
        grid.lineTo(x, bottom);
        grid.moveTo(left, y);
        grid.lineTo(right, y);
      }
      ctx.lineWidth = lineWidth * HALO_WIDTH;
      ctx.strokeStyle = this.cropGridHalo;
      ctx.stroke(grid);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.cropGrid;
      ctx.stroke(grid);
    }

    const outline = new Path2D();
    outline.rect(left + nudge, top + nudge, width, height);
    ctx.lineWidth = lineWidth * HALO_WIDTH;
    ctx.strokeStyle = this.cursorHalo;
    ctx.stroke(outline);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = this.cursorLine;
    ctx.stroke(outline);

    // Edge handles only where they leave room between the corners.
    const size = Math.round(BOX_HANDLE * dpr);
    const midX = Math.round((left + right) / 2);
    const midY = Math.round((top + bottom) / 2);
    const xs = width >= 3 * size ? [left, midX, right] : [left, right];
    const ys = height >= 3 * size ? [top, midY, bottom] : [top, bottom];
    ctx.fillStyle = this.cursorLine;
    ctx.strokeStyle = this.cursorHalo;
    for (const y of ys) {
      for (const x of xs) {
        const edgeX = x === left || x === right;
        const edgeY = y === top || y === bottom;
        if (!edgeX && !edgeY) continue;
        const hx = Math.round(x - size / 2);
        const hy = Math.round(y - size / 2);
        ctx.fillRect(hx, hy, size, size);
        ctx.strokeRect(hx + lineWidth / 2, hy + lineWidth / 2, size - lineWidth, size - lineWidth);
      }
    }
  }

  /**
   * A layer under Free Transform as applying would leave it: its own pixels drawn through
   * the transform with its opacity, then the layers above it, which the composite leaves
   * out with it. Only what lands on the canvas shows, as in the composite. Shrunk, both
   * are drawn from their pyramids (see `CanvasPyramid`): mipmapped smoothing, as the
   * composite is drawn with, would cost tens of milliseconds a frame for large layers.
   */
  private drawTransformed(
    transform: TransformOverlay,
    above: CanvasPyramid | null,
    placement: DocumentPlacement,
    zoom: number,
  ): void {
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(placement.x, placement.y, placement.width, placement.height);
    ctx.clip();
    const { scaleX, scaleY } = placement;
    ctx.setTransform(scaleX, 0, 0, scaleY, placement.x, placement.y);
    const [a, b, c, d, e, f] = transform.affine;
    ctx.transform(a, b, c, d, e, f);
    ctx.globalAlpha = transform.opacity;
    // Nearest neighbour shows hard pixels, except zoomed out, where the composite is
    // smoothed too.
    const smooth = transform.interpolation !== 'nearest' || zoom < 1;
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = 'low';
    const { pixels } = transform;
    const source = this.transformPyramid(pixels);
    const scale = smooth ? drawScale(scaleX * a, scaleY * b, scaleX * c, scaleY * d) : 1;
    ctx.drawImage(source.at(scale), transform.x, transform.y, pixels.width, pixels.height);
    if (above) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = zoom < 1;
      const image = above.at(Math.min(scaleX, scaleY));
      ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
    }
    ctx.restore();
  }

  /** `pixels` on a canvas, with its pyramid, kept while the same pixels are transformed. */
  private transformPyramid(pixels: PixelBuffer): CanvasPyramid {
    if (this.transformSource?.pixels === pixels) return this.transformSource.pyramid;
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    const pyramid = new CanvasPyramid(canvas, pixels.width, pixels.height);
    this.transformSource = { pixels, pyramid };
    return pyramid;
  }

  /**
   * Free Transform's box: the outline of where the layer goes, with square handles at its
   * corners and the middles of its edges, and a ring at the pivot. Drawn in device pixels,
   * the box's edges on the device pixel grid while it's upright.
   */
  private drawTransformBox(
    transform: TransformOverlay,
    placement: DocumentPlacement,
    dpr: number,
    lineWidth: number,
    nudge: number,
  ): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    const device = transform.corners.map(({ x, y }) => ({
      x: placement.x + x * placement.scaleX,
      y: placement.y + y * placement.scaleY,
    }));
    const edges = device.map((p, i) => [p, device[(i + 1) % device.length]] as const);
    const upright = edges.every(
      ([p, q]) => Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6,
    );
    const corners = upright
      ? device.map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))
      : device;
    const shift = upright ? nudge : 0;
    const outline = new Path2D();
    for (const { x, y } of corners) outline.lineTo(x + shift, y + shift);
    outline.closePath();
    ctx.lineWidth = lineWidth * HALO_WIDTH;
    ctx.strokeStyle = this.cursorHalo;
    ctx.stroke(outline);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = this.cursorLine;
    ctx.stroke(outline);

    // Edge handles only where they leave room between the corners.
    const size = Math.round(BOX_HANDLE * dpr);
    const handles: Point[] = [];
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length];
      handles.push(p);
      if (Math.hypot(q.x - p.x, q.y - p.y) >= 3 * size) {
        handles.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      }
    });
    ctx.fillStyle = this.cursorLine;
    ctx.strokeStyle = this.cursorHalo;
    for (const { x, y } of handles) {
      const hx = Math.round(x - size / 2);
      const hy = Math.round(y - size / 2);
      ctx.fillRect(hx, hy, size, size);
      ctx.strokeRect(hx + lineWidth / 2, hy + lineWidth / 2, size - lineWidth, size - lineWidth);
    }
    this.drawRing(transform.pivot, placement, dpr, lineWidth);
  }
}
