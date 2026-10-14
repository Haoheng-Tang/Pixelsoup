import type { Point, Selection } from '../../core';
import type {
  BrushOverlay,
  CropOverlay,
  LassoOverlay,
  ShapeOverlay,
  ToolOverlay,
} from '../tools/tool';
import type { AntPhaseKey, AntsOutline, DocumentPlacement } from './ants';
import {
  ANT_DASH,
  ANT_PHASES,
  AntPhaseCache,
  AntsOutlineCache,
  PRERENDER_MAX_PIXELS,
  PRERENDER_MIN_VERTICES,
  deviceRegion,
  lineWidthFor,
  staticLoopCount,
} from './ants';
import { createCheckerPattern } from './checkerboard';

/** Everything the overlay shows in one frame. */
export interface OverlayFrame {
  readonly selection: Selection | null;
  readonly preview: ToolOverlay | null;
  /** Null when the document isn't visible. */
  readonly placement: DocumentPlacement | null;
  readonly dpr: number;
  /** CSS pixels per canvas pixel. */
  readonly zoom: number;
  /** Animation step, 0 to `ANT_PHASES` − 1: the ants move one CSS pixel per step. */
  readonly phase: number;
  /** A wheel zoom is in progress: an outline traced for an earlier zoom will do. */
  readonly zooming: boolean;
  /** A pan or wheel zoom is in progress: the ants are stroked, not prerendered. */
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
/** The crop box's square handles, in CSS pixels across. */
const CROP_HANDLE = 7;
/** The ring that marks where a click closes a lasso, in CSS pixels across. */
const CLOSE_RING = 9;

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
 * crop box, and a painting tool's brush outline, on a transparent canvas stacked above the
 * composite.
 *
 * The selection's outline is traced once per selection and zoom bucket (`AntsOutlineCache`:
 * at screen resolution when zoomed out). Each frame strokes it through the current pan and
 * zoom with the step's dash offset; outlines with many corners are drawn once per phase and
 * blitted from then on, until the view or the selection changes. Loops too short on screen
 * to animate are drawn solid, and lines are one device pixel per CSS pixel at every zoom.
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
  /** Brush outline colours, from the `--cursor-line` and `--cursor-halo` tokens. */
  private readonly cursorLine: string;
  private readonly cursorHalo: string;
  /** Crop box colours, from the `--crop-*` tokens. */
  private readonly cropShade: string;
  private readonly cropGrid: string;
  private readonly cropGridHalo: string;
  private checker: CanvasPattern | string | null = null;
  private checkerDpr = 0;
  constructor(container: HTMLElement) {
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
  }

  /** Removes the overlay's canvas. */
  dispose(): void {
    this.canvas.remove();
  }

  /** Redraws the overlay. */
  draw(frame: OverlayFrame): void {
    const { selection, preview, placement, dpr, phase } = frame;
    const brush = preview?.shape === 'brush' ? preview : null;
    const crop = preview?.shape === 'crop' ? preview : null;
    const shape = preview?.shape === 'rect' || preview?.shape === 'ellipse' ? preview : null;
    const lasso = preview?.shape === 'lasso' ? preview : null;
    const hidesSelection = shape?.hidesSelection ?? lasso?.hidesSelection ?? false;
    const ants = !hidesSelection && placement ? selection : null;
    if (!selection) this.releaseOutlines();
    if (!ants) this.phases.release();

    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!placement) return;
    if (ants) this.drawAnts(ants, frame, placement);

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
      if (lasso.closing && first) this.drawCloseRing(first, placement, dpr, lineWidth);
    }
    if (crop) this.drawCrop(crop, placement, dpr, lineWidth, nudge);
    if (brush) this.drawBrush(brush, placement, dpr, lineWidth, nudge);
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
   * A ring around a lasso's first point, where a click would close it, the same size at
   * every zoom. Drawn in device pixels.
   */
  private drawCloseRing(
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
    path.arc(x, y, (CLOSE_RING * dpr) / 2, 0, 2 * Math.PI);
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
   * The crop box: everything outside it shaded, the area it adds beyond the canvas shown as
   * transparent, a rule-of-thirds grid while it's being adjusted, its outline and eight
   * square handles. Drawn in device pixels, with the box's edges on the device pixel grid.
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

    const shade = new Path2D();
    shade.rect(0, 0, this.canvas.width, this.canvas.height);
    shade.rect(left, top, width, height);
    ctx.fillStyle = this.cropShade;
    ctx.fill(shade, 'evenodd');

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
    const size = Math.round(CROP_HANDLE * dpr);
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
}
