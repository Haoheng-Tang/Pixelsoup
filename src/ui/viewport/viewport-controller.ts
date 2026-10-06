import type { Editor } from '../../core';
import { isTextEntry } from '../dom';
import type { CompositeRenderer } from '../render/composite-renderer';
import { CpuCompositeRenderer } from '../render/composite-renderer';
import type { ToolKeyEvent, ToolModifiers, ToolPointerEvent } from '../tools/tool';
import type { ToolManager } from '../tools/tool-manager';
import type { DocumentPlacement } from './selection-overlay';
import { ANT_STEP_MS, SelectionOverlay } from './selection-overlay';
import type { ViewTransform } from './view-transform';
import { centered, fitZoom, nextZoomStep, screenToDocument, zoomAt } from './view-transform';

const BACKGROUND = '#1b1b1d';
const CHECKER_LIGHT = '#ffffff';
const CHECKER_DARK = '#cccccc';
/** Checkerboard square size in CSS pixels (constant on screen regardless of zoom). */
const CHECKER_SIZE = 8;
/** Zoom change per pixel of wheel delta; one 100px notch ≈ ×1.16. */
const WHEEL_ZOOM_SPEED = 0.0015;

const NO_MODIFIERS: ToolModifiers = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};

type ZoomListener = (zoom: number) => void;

/** What the status bar shows. */
export interface ViewportStatus {
  /** Document pixel under the pointer; null while the pointer is away from the canvas. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** Size of the shape a tool is dragging, else of the selection's bounds; null if neither. */
  readonly selectionSize: { readonly width: number; readonly height: number } | null;
}

type StatusListener = (status: ViewportStatus) => void;

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startView: ViewTransform;
}

interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

function modifiersOf(e: KeyboardEvent | MouseEvent): ToolModifiers {
  return { shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
}

function toolKeyEvent(e: KeyboardEvent): ToolKeyEvent {
  return { key: e.key, code: e.code, repeat: e.repeat, ...modifiersOf(e) };
}

/**
 * Imperative canvas viewport: draws the document composite over a checkerboard, the
 * selection's marching ants and the active tool's preview on an overlay canvas above it,
 * handles zoom (wheel, centered on the cursor) and pan (space+drag, middle-drag), and
 * routes all other pointer input to the active tool in document coordinates.
 *
 * Deliberately outside React: pointer and wheel input never trigger React renders.
 * Redraws are coalesced into one requestAnimationFrame; while there is a selection the
 * frame loop keeps running and redraws only the overlay as the ants move.
 */
export class ViewportController {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly overlay: SelectionOverlay;
  private renderer: CompositeRenderer;
  private readonly zoomListeners = new Set<ZoomListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly cleanups: (() => void)[] = [];

  private view: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private hasFitted = false;
  private frame = 0;
  private mainDirty = false;
  private overlayDirty = false;
  private antPhase = 0;
  private placement: DocumentPlacement | null = null;
  private checker: CanvasPattern | null = null;
  private checkerDpr = 0;
  private status: ViewportStatus = { pointer: null, selectionSize: null };

  private spaceHeld = false;
  private pointerInside = false;
  private drag: PanDrag | null = null;
  /** The pointer whose press went to the active tool, until it is released or cancelled. */
  private toolPointerId: number | null = null;
  /** Last pointer position over the canvas (or captured by a gesture). */
  private pointer: ClientPoint | null = null;
  private modifiers: ToolModifiers = NO_MODIFIERS;

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: Editor,
    private readonly tools: ToolManager,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Document canvas');
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
    container.appendChild(this.canvas);
    this.overlay = new SelectionOverlay(container);

    const doc = editor.document;
    this.renderer = new CpuCompositeRenderer(doc.width, doc.height);
    this.renderer.update(doc);

    this.cleanups.push(
      editor.subscribe((change) => {
        if (change.documentReplaced) {
          // The new document may have another size: start over with a fresh composite.
          const doc = this.editor.document;
          this.renderer = new CpuCompositeRenderer(doc.width, doc.height);
          this.renderer.update(doc);
          if (this.cssWidth > 0 && this.cssHeight > 0) this.fitToView();
          else this.hasFitted = false;
          this.invalidate();
          this.emitStatus();
          return;
        }
        if (change.selectionDirty) {
          this.invalidateOverlay();
          this.emitStatus();
        }
        if (!change.dirty) return;
        this.renderer.update(this.editor.document, [change.dirty]);
        this.invalidate();
      }),
      tools.subscribe(() => this.updateCursor()),
      tools.subscribeOverlay(() => {
        this.invalidateOverlay();
        this.emitStatus();
      }),
    );

    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(container);
    this.cleanups.push(() => resizeObserver.disconnect());

    this.listen(this.canvas, 'wheel', this.handleWheel, { passive: false });
    this.listen(this.canvas, 'pointerdown', this.handlePointerDown);
    this.listen(this.canvas, 'pointermove', this.handlePointerMove);
    this.listen(this.canvas, 'pointerup', this.handlePointerUp);
    this.listen(this.canvas, 'pointercancel', this.handlePointerCancel);
    this.listen(this.canvas, 'pointerenter', () => (this.pointerInside = true));
    this.listen(this.canvas, 'pointerleave', this.handlePointerLeave);
    // Stop the browser's middle-click autoscroll.
    this.listen(this.canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.listen(window, 'keydown', this.handleKeyDown);
    this.listen(window, 'keyup', this.handleKeyUp);
    this.listen(window, 'blur', () => {
      this.modifiers = NO_MODIFIERS;
      this.setSpaceHeld(false);
      this.cancelToolGesture();
    });

    this.updateCursor();
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

  /** Subscribes to status changes; the listener is called immediately with the current status. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    this.status = this.computeStatus();
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
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
    this.cancelToolGesture();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.zoomListeners.clear();
    this.statusListeners.clear();
    this.canvas.remove();
    this.overlay.canvas.remove();
  }

  private zoomAroundCenter(zoom: number): void {
    this.setView(zoomAt(this.view, zoom, this.cssWidth / 2, this.cssHeight / 2));
  }

  private setView(view: ViewTransform): void {
    const zoomChanged = view.zoom !== this.view.zoom;
    this.view = view;
    this.invalidate();
    if (zoomChanged) for (const listener of this.zoomListeners) listener(view.zoom);
    // The document moved under the pointer: tell the tool where the pointer is now.
    if (this.toolPointerId !== null && this.pointer) {
      this.tools.pointerMove(this.toolEvent(this.pointer));
    }
    this.emitStatus();
  }

  /** Schedules a redraw of everything. */
  private invalidate(): void {
    this.mainDirty = true;
    this.requestFrame();
  }

  /** Schedules a redraw of the overlay only (selection or tool preview changed). */
  private invalidateOverlay(): void {
    this.overlayDirty = true;
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.handleFrame);
  }

  private readonly handleFrame = (time: number): void => {
    this.frame = 0;
    const phase = Math.floor(time / ANT_STEP_MS);
    if (this.mainDirty) this.render(phase);
    else if (this.overlayDirty || (this.hasAnts() && phase !== this.antPhase)) {
      this.renderOverlay(phase);
    }
    // Keep the ants marching; frames without a new step draw nothing.
    if (this.hasAnts()) this.requestFrame();
  };

  private hasAnts(): boolean {
    return this.editor.document.selection !== null || this.tools.overlay !== null;
  }

  private handleResize(): void {
    const bounds = this.container.getBoundingClientRect();
    this.cssWidth = bounds.width;
    this.cssHeight = bounds.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(bounds.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(bounds.height * this.dpr));
    this.overlay.resize(this.canvas.width, this.canvas.height);
    if (!this.hasFitted && bounds.width > 0 && bounds.height > 0) {
      this.hasFitted = true;
      this.fitToView();
    }
    // Resizing clears the canvas, so draw synchronously to avoid a blank frame.
    this.render();
  }

  /** Redraws the composite and the overlay now. */
  private render(phase = Math.floor(performance.now() / ANT_STEP_MS)): void {
    if ((window.devicePixelRatio || 1) !== this.dpr) {
      this.handleResize();
      return;
    }
    this.mainDirty = false;
    this.renderComposite();
    this.renderOverlay(phase);
    if (this.hasAnts()) this.requestFrame();
  }

  private renderOverlay(phase: number): void {
    this.overlayDirty = false;
    this.antPhase = phase;
    this.overlay.draw(
      this.editor.document.selection,
      this.tools.overlay,
      this.placement,
      this.dpr,
      phase,
    );
  }

  private renderComposite(): void {
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
    if (w <= 0 || h <= 0) {
      this.placement = null;
      return;
    }
    // The overlay maps document coordinates exactly as the composite is drawn.
    this.placement = {
      x: x0,
      y: y0,
      scaleX: w / this.renderer.width,
      scaleY: h / this.renderer.height,
    };

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
    if (this.drag || this.toolPointerId !== null) return;
    const isPan = e.button === 1 || (e.button === 0 && this.spaceHeld);
    if (!isPan && e.button !== 0) return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.trackPointer(e);
    if (isPan) {
      this.drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startView: this.view,
      };
      this.updateCursor();
      return;
    }
    this.toolPointerId = e.pointerId;
    this.tools.pointerDown(this.toolEvent(e));
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      this.trackPointer(e);
      this.setView({
        zoom: drag.startView.zoom,
        panX: drag.startView.panX + (e.clientX - drag.startX),
        panY: drag.startView.panY + (e.clientY - drag.startY),
      });
      return;
    }
    if (this.toolPointerId !== null && e.pointerId !== this.toolPointerId) return;
    this.trackPointer(e);
    // Moves with no button down (hover) go to the tool too.
    this.tools.pointerMove(this.toolEvent(e));
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.drag) {
      if (e.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      this.releasePointer(e.pointerId);
      this.updateCursor();
      return;
    }
    if (e.pointerId !== this.toolPointerId) return;
    this.toolPointerId = null;
    this.releasePointer(e.pointerId);
    this.trackPointer(e);
    this.tools.pointerUp(this.toolEvent(e));
    this.updateCursor();
    if (!this.pointerInside) this.forgetPointer();
  };

  private readonly handlePointerCancel = (e: PointerEvent): void => {
    if (this.drag?.pointerId === e.pointerId) {
      this.drag = null;
      this.updateCursor();
    } else if (e.pointerId === this.toolPointerId) {
      this.cancelToolGesture();
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerInside = false;
    if (!this.drag && this.toolPointerId === null) this.forgetPointer();
  };

  /** Abandons the tool's pointer gesture, if any, without committing it. */
  private cancelToolGesture(): void {
    if (this.toolPointerId === null) return;
    this.releasePointer(this.toolPointerId);
    this.toolPointerId = null;
    this.tools.cancel();
    this.updateCursor();
  }

  private releasePointer(pointerId: number): void {
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }

  private trackPointer(e: PointerEvent): void {
    this.pointer = { clientX: e.clientX, clientY: e.clientY };
    this.modifiers = modifiersOf(e);
    this.emitStatus();
  }

  private forgetPointer(): void {
    this.pointer = null;
    this.emitStatus();
  }

  private toolEvent(point: ClientPoint): ToolPointerEvent {
    const [x, y] = this.documentPoint(point);
    return { x, y, zoom: this.view.zoom, ...this.modifiers };
  }

  private documentPoint(point: ClientPoint): [number, number] {
    const bounds = this.canvas.getBoundingClientRect();
    return screenToDocument(this.view, point.clientX - bounds.left, point.clientY - bounds.top);
  }

  /** Keys go to the tool while the user is working on the canvas. */
  private toolWantsKeys(): boolean {
    return (
      this.toolPointerId !== null || this.pointerInside || document.activeElement === this.canvas
    );
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.modifiers = modifiersOf(e);
    if (isTextEntry(e.target)) return;
    if (e.code === 'Space') {
      // Only claim Space while the user is working on the canvas, so it still
      // activates focused buttons and checkboxes elsewhere.
      if (!this.pointerInside && document.activeElement !== this.canvas && !this.drag) return;
      e.preventDefault();
      this.setSpaceHeld(true);
      return;
    }
    if (this.toolWantsKeys() && this.tools.keyDown(toolKeyEvent(e))) e.preventDefault();
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.modifiers = modifiersOf(e);
    if (e.code === 'Space') {
      if (!this.spaceHeld) return;
      e.preventDefault();
      this.setSpaceHeld(false);
      return;
    }
    if (isTextEntry(e.target)) return;
    if (this.toolWantsKeys() && this.tools.keyUp(toolKeyEvent(e))) e.preventDefault();
  };

  private setSpaceHeld(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.updateCursor();
  }

  private updateCursor(): void {
    let cursor = this.tools.activeTool.cursor;
    if (this.drag) cursor = 'grabbing';
    else if (this.spaceHeld && this.toolPointerId === null) cursor = 'grab';
    this.canvas.style.cursor = cursor;
  }

  private computeStatus(): ViewportStatus {
    let pointer: ViewportStatus['pointer'] = null;
    if (this.pointer) {
      const [x, y] = this.documentPoint(this.pointer);
      pointer = { x: Math.floor(x), y: Math.floor(y) };
    }
    const area = this.tools.overlay?.rect ?? this.editor.document.selection?.bounds() ?? null;
    const selectionSize = area ? { width: area.width, height: area.height } : null;
    return { pointer, selectionSize };
  }

  /** Recomputes the status and notifies listeners if it changed. */
  private emitStatus(): void {
    if (this.statusListeners.size === 0) return;
    const next = this.computeStatus();
    const prev = this.status;
    if (
      next.pointer?.x === prev.pointer?.x &&
      next.pointer?.y === prev.pointer?.y &&
      next.selectionSize?.width === prev.selectionSize?.width &&
      next.selectionSize?.height === prev.selectionSize?.height
    ) {
      return;
    }
    this.status = next;
    for (const listener of this.statusListeners) listener(next);
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
