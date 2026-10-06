import type { Selection, SelectionOutline } from '../../core';
import { traceSelectionOutline } from '../../core';
import type { ToolOverlay } from '../tools/tool';

/** Where the document sits on the canvas, in device pixels: device = origin + doc × scale. */
export interface DocumentPlacement {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Length of each dash (and gap) of the marching ants, in CSS pixels. */
const DASH = 4;
/** The ants advance one CSS pixel per step. */
export const ANT_STEP_MS = 60;

/** A Path2D in document coordinates tracing every loop of `outline`. */
export function outlinePath(outline: SelectionOutline): Path2D {
  const path = new Path2D();
  for (const loop of outline.loops) {
    path.moveTo(loop[0], loop[1]);
    for (let i = 2; i < loop.length; i += 2) path.lineTo(loop[i], loop[i + 1]);
    path.closePath();
  }
  return path;
}

function previewPath({ shape, rect }: ToolOverlay): Path2D {
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

/**
 * Draws the selection's marching ants, and any shape the active tool is previewing, on
 * a transparent canvas stacked above the composite.
 *
 * The selection outline is traced into a Path2D in document coordinates once per
 * selection; each frame only re-strokes it through the current pan/zoom transform with
 * a new dash offset. Lines are one device pixel wide (about 1 CSS pixel) at every zoom.
 */
export class SelectionOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private pathSelection: Selection | null = null;
  private path: Path2D | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
    container.appendChild(this.canvas);
  }

  /** Matches the main canvas's backing size in device pixels. */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Redraws the overlay. `phase` counts animation steps; each step moves the ants along
   * by one CSS pixel. `placement` is null when the document isn't visible.
   */
  draw(
    selection: Selection | null,
    preview: ToolOverlay | null,
    placement: DocumentPlacement | null,
    dpr: number,
    phase: number,
  ): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!selection) this.releasePath();
    if (!placement) return;

    // A line of odd device width is crisp when centred on a device pixel's middle.
    const lineWidth = Math.max(1, Math.round(dpr));
    const nudge = lineWidth % 2 === 1 ? 0.5 : 0;
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
    const dash = (DASH * dpr) / scale;
    const offset = (-(phase % (2 * DASH)) * dpr) / scale;

    if (selection && !preview?.hidesSelection)
      this.strokeAnts(this.outline(selection), dash, offset);
    if (preview) this.strokeAnts(previewPath(preview), dash, offset);
  }

  private outline(selection: Selection): Path2D {
    if (selection !== this.pathSelection || !this.path) {
      this.path = outlinePath(traceSelectionOutline(selection));
      this.pathSelection = selection;
    }
    return this.path;
  }

  private releasePath(): void {
    this.pathSelection = null;
    this.path = null;
  }

  private strokeAnts(path: Path2D, dash: number, offset: number): void {
    const ctx = this.context;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(path);
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = offset;
    ctx.strokeStyle = '#000000';
    ctx.stroke(path);
  }
}
