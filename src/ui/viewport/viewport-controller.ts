import type { Editor } from '../../core';
import type { CompositeRenderer } from '../render/composite-renderer';
import { CpuCompositeRenderer } from '../render/composite-renderer';
import type { ViewTransform } from './view-transform';
import { centered, fitZoom, nextZoomStep, zoomAt } from './view-transform';

const BACKGROUND = '#1b1b1d';
const CHECKER_LIGHT = '#ffffff';
const CHECKER_DARK = '#cccccc';
/** Checkerboard square size in CSS pixels (constant on screen regardless of zoom). */
const CHECKER_SIZE = 8;
/** Zoom change per pixel of wheel delta; one 100px notch ≈ ×1.16. */
const WHEEL_ZOOM_SPEED = 0.0015;

type ZoomListener = (zoom: number) => void;

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startView: ViewTransform;
}

/**
 * Imperative canvas viewport: draws the document composite over a checkerboard and
 * handles zoom (wheel, centered on the cursor) and pan (space+drag, middle-drag).
 *
 * Deliberately outside React: pointer and wheel input never trigger React renders.
 * Redraws are coalesced into one requestAnimationFrame.
 */
export class ViewportController {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly renderer: CompositeRenderer;
  private readonly zoomListeners = new Set<ZoomListener>();
  private readonly cleanups: (() => void)[] = [];

  private view: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private hasFitted = false;
  private frame = 0;
  private checker: CanvasPattern | null = null;
  private checkerDpr = 0;

  private spaceHeld = false;
  private pointerInside = false;
  private drag: PanDrag | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: Editor,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Document canvas');
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
    container.appendChild(this.canvas);

    const doc = editor.document;
    this.renderer = new CpuCompositeRenderer(doc.width, doc.height);
    this.renderer.update(doc);

    this.cleanups.push(
      editor.subscribe((change) => {
        if (!change.dirty) return;
        this.renderer.update(this.editor.document, [change.dirty]);
        this.invalidate();
      }),
    );

    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(container);
    this.cleanups.push(() => resizeObserver.disconnect());

    this.listen(this.canvas, 'wheel', this.handleWheel, { passive: false });
    this.listen(this.canvas, 'pointerdown', this.handlePointerDown);
    this.listen(this.canvas, 'pointermove', this.handlePointerMove);
    this.listen(this.canvas, 'pointerup', this.handlePointerUp);
    this.listen(this.canvas, 'pointercancel', this.handlePointerUp);
    this.listen(this.canvas, 'pointerenter', () => (this.pointerInside = true));
    this.listen(this.canvas, 'pointerleave', () => (this.pointerInside = false));
    // Stop the browser's middle-click autoscroll.
    this.listen(this.canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.listen(window, 'keydown', this.handleKeyDown);
    this.listen(window, 'keyup', this.handleKeyUp);
    this.listen(window, 'blur', () => this.setSpaceHeld(false));

    this.handleResize();
  }

  get zoom(): number {
    return this.view.zoom;
  }

  /** Subscribes to zoom changes; the listener is called immediately with the current zoom. */
  onZoomChange(listener: ZoomListener): () => void {
    this.zoomListeners.add(listener);
    listener(this.view.zoom);
    return () => {
      this.zoomListeners.delete(listener);
    };
  }

  fitToView(): void {
    const { width, height } = this.editor.document;
    const zoom = fitZoom(width, height, this.cssWidth, this.cssHeight);
    this.setView(centered(zoom, width, height, this.cssWidth, this.cssHeight));
  }

  actualSize(): void {
    this.zoomAroundCenter(1);
  }

  zoomIn(): void {
    this.zoomAroundCenter(nextZoomStep(this.view.zoom, 1));
  }

  zoomOut(): void {
    this.zoomAroundCenter(nextZoomStep(this.view.zoom, -1));
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.zoomListeners.clear();
    this.canvas.remove();
  }

  private zoomAroundCenter(zoom: number): void {
    this.setView(zoomAt(this.view, zoom, this.cssWidth / 2, this.cssHeight / 2));
  }

  private setView(view: ViewTransform): void {
    const zoomChanged = view.zoom !== this.view.zoom;
    this.view = view;
    this.invalidate();
    if (zoomChanged) for (const listener of this.zoomListeners) listener(view.zoom);
  }

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private handleResize(): void {
    const bounds = this.container.getBoundingClientRect();
    this.cssWidth = bounds.width;
    this.cssHeight = bounds.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(bounds.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(bounds.height * this.dpr));
    if (!this.hasFitted && bounds.width > 0 && bounds.height > 0) {
      this.hasFitted = true;
      this.fitToView();
    }
    // Resizing clears the canvas, so draw synchronously to avoid a blank frame.
    this.render();
  }

  private render(): void {
    if ((window.devicePixelRatio || 1) !== this.dpr) {
      this.handleResize();
      return;
    }
    const ctx = this.context;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Document rect in device pixels, snapped so edges stay crisp.
    const { zoom, panX, panY } = this.view;
    const x0 = Math.round(panX * dpr);
    const y0 = Math.round(panY * dpr);
    const x1 = Math.round((panX + this.renderer.width * zoom) * dpr);
    const y1 = Math.round((panY + this.renderer.height * zoom) * dpr);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    const checker = this.checkerPattern();
    if (typeof checker !== 'string') checker.setTransform(new DOMMatrix([1, 0, 0, 1, x0, y0]));
    ctx.fillStyle = checker;
    ctx.fillRect(x0, y0, w, h);

    // Smooth when zoomed out; show hard pixel edges when zoomed in.
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.renderer.image, x0, y0, w, h);
  }

  private checkerPattern(): CanvasPattern | string {
    if (this.checker && this.checkerDpr === this.dpr) return this.checker;
    const size = Math.max(1, Math.round(CHECKER_SIZE * this.dpr));
    const tile = document.createElement('canvas');
    tile.width = tile.height = size * 2;
    const tctx = tile.getContext('2d');
    if (!tctx) return CHECKER_LIGHT;
    tctx.fillStyle = CHECKER_LIGHT;
    tctx.fillRect(0, 0, size * 2, size * 2);
    tctx.fillStyle = CHECKER_DARK;
    tctx.fillRect(size, 0, size, size);
    tctx.fillRect(0, size, size, size);
    this.checker = this.context.createPattern(tile, 'repeat');
    this.checkerDpr = this.dpr;
    return this.checker ?? CHECKER_LIGHT;
  }

  private readonly handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= this.cssHeight;
    const [sx, sy] = this.localPoint(e);
    this.setView(zoomAt(this.view, this.view.zoom * Math.exp(-delta * WHEEL_ZOOM_SPEED), sx, sy));
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    const isPan = e.button === 1 || (e.button === 0 && this.spaceHeld);
    if (!isPan || this.drag) return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startView: this.view,
    };
    this.updateCursor();
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.setView({
      zoom: drag.startView.zoom,
      panX: drag.startView.panX + (e.clientX - drag.startX),
      panY: drag.startView.panY + (e.clientY - drag.startY),
    });
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.updateCursor();
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' || isTextEntry(e.target)) return;
    // Only claim Space while the user is working on the canvas, so it still
    // activates focused buttons and checkboxes elsewhere.
    if (!this.pointerInside && document.activeElement !== this.canvas && !this.drag) return;
    e.preventDefault();
    this.setSpaceHeld(true);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' || !this.spaceHeld) return;
    e.preventDefault();
    this.setSpaceHeld(false);
  };

  private setSpaceHeld(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.updateCursor();
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.drag ? 'grabbing' : this.spaceHeld ? 'grab' : '';
  }

  private localPoint(e: MouseEvent): [number, number] {
    const bounds = this.canvas.getBoundingClientRect();
    return [e.clientX - bounds.left, e.clientY - bounds.top];
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(
    target.type,
  );
}
