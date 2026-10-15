import type { Editor, Rect } from '../../core';
import { assertNever, roundRectOut, transformedBounds } from '../../core';
import { isContextClick, isOnCanvas } from '../canvas-menu';
import { isTextEntry } from '../dom';
import type { CompositeRenderer } from '../render/composite-renderer';
import { CpuCompositeRenderer } from '../render/composite-renderer';
import { lassoBounds } from '../tools/lasso-tool';
import { IS_APPLE } from '../use-file-shortcuts';
import type {
  ToolKeyEvent,
  ToolModifiers,
  ToolOverlay,
  ToolPointerEvent,
  ToolPointerSample,
} from '../tools/tool';
import type { ToolManager } from '../tools/tool-manager';
import type { DocumentPlacement } from './ants';
import { ANT_PHASES, ANT_STEP_MS, ZOOM_SETTLE_MS } from './ants';
import { createCheckerPattern } from './checkerboard';
import { SelectionOverlay } from './selection-overlay';
import type { ViewOptions } from './view-options';
import type { ViewTransform } from './view-transform';
import { centered, fitZoom, nextZoomStep, screenToDocument, zoomAt } from './view-transform';

const BACKGROUND = '#1b1b1d';
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
  /**
   * Size of the shape or lasso a tool is drawing or the crop box, else of the selection's
   * bounds; null if none.
   */
  readonly selectionSize: { readonly width: number; readonly height: number } | null;
}

type StatusListener = (status: ViewportStatus) => void;

/** Asked to open the canvas's context menu at a point in client coordinates. */
type ContextMenuListener = (at: { readonly x: number; readonly y: number }) => void;

/** While `blocked` (a dialog is open), keys belong to the dialog, not to panning or the tool. */
export interface KeyGate {
  readonly blocked: boolean;
}

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

/** Pen pressure; mice report a fixed 0.5 while pressed, and touch pressure is unreliable. */
function penPressure(e: PointerEvent): number | undefined {
  return e.pointerType === 'pen' ? e.pressure : undefined;
}

/** The positions a pointer move passed through, oldest first, where the browser reports them. */
function coalescedEvents(e: PointerEvent): readonly PointerEvent[] {
  // Only in secure contexts, so it may be missing despite the type.
  if (e.type !== 'pointermove' || typeof e.getCoalescedEvents !== 'function') return [];
  return e.getCoalescedEvents();
}

/** The area of what a tool is drawing, for the status bar: a shape, lasso or crop box. */
function overlayArea(overlay: ToolOverlay | null): Rect | null {
  if (!overlay) return null;
  switch (overlay.shape) {
    case 'rect':
    case 'ellipse':
    case 'crop':
      return overlay.rect;
    case 'lasso':
      return lassoBounds(overlay);
    case 'transform':
      return transformedBounds(overlay.affine, {
        x: overlay.x,
        y: overlay.y,
        width: overlay.pixels.width,
        height: overlay.pixels.height,
      });
    case 'brush':
      return null;
    default:
      return assertNever(overlay);
  }
}

/**
 * Imperative canvas viewport: draws the document composite over a checkerboard, the
 * selection's marching ants and the active tool's preview on an overlay canvas above it,
 * handles zoom (wheel, centered on the cursor) and pan (space+drag, middle-drag), and
 * routes all other pointer input to the active tool in document coordinates.
 *
 * Deliberately outside React: pointer and wheel input never trigger React renders.
 * Redraws are coalesced into one requestAnimationFrame. While ants show, a timer moves them
 * on a step about 12 times a second and redraws only the overlay; they stand still while a
 * pan or wheel zoom is in progress.
 */
export class ViewportController {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly overlay: SelectionOverlay;
  private renderer: CompositeRenderer;
  private readonly zoomListeners = new Set<ZoomListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly contextMenuListeners = new Set<ContextMenuListener>();
  private readonly cleanups: (() => void)[] = [];

  private view: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private hasFitted = false;
  private frame = 0;
  private mainDirty = false;
  private overlayDirty = false;
  /** The ants' animation step, 0 to `ANT_PHASES` − 1. */
  private antPhase = 0;
  private antTimer = 0;
  /** A wheel zoom is in progress, until `ZOOM_SETTLE_MS` after its last notch. */
  private zooming = false;
  private zoomTimer = 0;
  private placement: DocumentPlacement | null = null;
  private checker: CanvasPattern | string | null = null;
  private checkerDpr = 0;
  private status: ViewportStatus = { pointer: null, selectionSize: null };
  private cursor = '';

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
    private readonly viewOptions: ViewOptions,
    private readonly gate: KeyGate,
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
        if (change.documentReplaced || change.resized) {
          // The canvas may have another size: start over with a fresh composite. A new
          // document is fitted to the view; a resized one keeps the zoom, centred.
          const doc = this.editor.document;
          this.renderer = new CpuCompositeRenderer(doc.width, doc.height);
          this.renderer.update(doc);
          if (this.cssWidth <= 0 || this.cssHeight <= 0) this.hasFitted = false;
          else if (change.documentReplaced) this.fitToView();
          else {
            const { zoom } = this.view;
            this.setView(centered(zoom, doc.width, doc.height, this.cssWidth, this.cssHeight));
          }
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
      tools.subscribe(() => {
        this.updateCursor();
        // The new tool doesn't know where the pointer is yet, e.g. to show a brush outline.
        this.resendPointer();
      }),
      tools.subscribeOverlay(() => {
        this.updateCursor();
        this.invalidateOverlay();
        this.emitStatus();
      }),
      viewOptions.subscribe(() => this.invalidateOverlay()),
    );

    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(container);
    this.cleanups.push(() => resizeObserver.disconnect());

    this.listen(this.canvas, 'wheel', this.handleWheel, { passive: false });
    this.listen(this.canvas, 'pointerdown', this.handlePointerDown);
    this.listen(this.canvas, 'pointermove', this.handlePointerMove);
    this.listen(this.canvas, 'pointerup', this.handlePointerUp);
    this.listen(this.canvas, 'pointercancel', this.handlePointerCancel);
    this.listen(this.canvas, 'pointerenter', this.handlePointerEnter);
    this.listen(this.canvas, 'pointerleave', this.handlePointerLeave);
    this.listen(this.canvas, 'dblclick', this.handleDoubleClick);
    this.listen(container, 'contextmenu', this.handleContextMenu);
    // Stop the browser's middle-click autoscroll.
    this.listen(this.canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    // On the document rather than the window, so the tool sees keys before the app's
    // shortcuts on the window do, and they can skip a key the tool took (defaultPrevented).
    this.listen(document, 'keydown', this.handleKeyDown);
    this.listen(document, 'keyup', this.handleKeyUp);
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

  /**
   * The document area the viewport shows, in document pixels, rounded out to whole pixels;
   * null before it has a size. It may reach past the canvas.
   */
  visibleArea(): Rect | null {
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return null;
    const [x0, y0] = screenToDocument(this.view, 0, 0);
    const [x1, y1] = screenToDocument(this.view, this.cssWidth, this.cssHeight);
    return roundRectOut({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
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

  /**
   * Subscribes to requests for the canvas's context menu: a right-click (or a Mac's
   * Control-click) over the document, outside any gesture, while not blocked. The
   * browser's own menu never shows over the viewport.
   */
  onContextMenu(listener: ContextMenuListener): () => void {
    this.contextMenuListeners.add(listener);
    return () => {
      this.contextMenuListeners.delete(listener);
    };
  }

  /** Gives the canvas the keyboard focus, e.g. when a menu over it closes. */
  focus(): void {
    this.canvas.focus({ preventScroll: true });
  }

  /** Whether `target` is the viewport or inside it. */
  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.container.contains(target);
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
    window.clearTimeout(this.antTimer);
    this.antTimer = 0;
    window.clearTimeout(this.zoomTimer);
    this.zoomTimer = 0;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.zoomListeners.clear();
    this.statusListeners.clear();
    this.contextMenuListeners.clear();
    this.canvas.remove();
    this.overlay.dispose();
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
    this.resendPointer();
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

  private readonly handleFrame = (): void => {
    this.frame = 0;
    if (this.mainDirty) this.render();
    else if (this.overlayDirty) this.renderOverlay();
  };

  /** Whether anything shows marching ants: the selection, or a shape or lasso being drawn. */
  private hasAnts(): boolean {
    const shape = this.tools.overlay?.shape;
    return (
      (this.viewOptions.showExtras && this.editor.document.selection !== null) ||
      shape === 'rect' ||
      shape === 'ellipse' ||
      shape === 'lasso'
    );
  }

  /** The ants stand still while the view is being panned or wheel-zoomed. */
  private viewChanging(): boolean {
    return this.drag !== null || this.zooming;
  }

  /** Moves the ants on a step in `ANT_STEP_MS`, while there are any and the view is still. */
  private scheduleAntStep(): void {
    if (this.antTimer || !this.hasAnts() || this.viewChanging()) return;
    this.antTimer = window.setTimeout(this.stepAnts, ANT_STEP_MS);
  }

  private readonly stepAnts = (): void => {
    this.antTimer = 0;
    if (!this.hasAnts() || this.viewChanging()) return;
    this.antPhase = (this.antPhase + 1) % ANT_PHASES;
    this.invalidateOverlay();
    // From now rather than from the redraw, so the steps keep time.
    this.scheduleAntStep();
  };

  private readonly settleZoom = (): void => {
    this.zoomTimer = 0;
    this.zooming = false;
    // Traces the outline for the zoom the wheel ended at, and starts the ants again.
    this.invalidateOverlay();
  };

  /** A brush outline follows the pointer over the canvas, but not while panning. */
  private showsBrush(): boolean {
    const gesture = this.toolPointerId !== null;
    return (this.pointerInside || gesture) && !this.drag && (gesture || !this.spaceHeld);
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
  private render(): void {
    if ((window.devicePixelRatio || 1) !== this.dpr) {
      this.handleResize();
      return;
    }
    this.mainDirty = false;
    this.renderComposite();
    this.renderOverlay();
  }

  private renderOverlay(): void {
    this.overlayDirty = false;
    const overlay = this.tools.overlay;
    this.overlay.draw({
      selection: this.editor.document.selection,
      showSelection: this.viewOptions.showExtras,
      preview: overlay?.shape === 'brush' && !this.showsBrush() ? null : overlay,
      placement: this.placement,
      dpr: this.dpr,
      zoom: this.view.zoom,
      phase: this.antPhase,
      zooming: this.zooming,
      viewChanging: this.viewChanging(),
    });
    this.scheduleAntStep();
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
      width: w,
      height: h,
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
    if (this.checker === null || this.checkerDpr !== this.dpr) {
      this.checker = createCheckerPattern(this.context, this.dpr);
      this.checkerDpr = this.dpr;
    }
    return this.checker;
  }

  private readonly handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= this.cssHeight;
    const [sx, sy] = this.localPoint(e);
    // The ants stand still, on the outline traced before, until the zoom settles.
    this.zooming = true;
    window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(this.settleZoom, ZOOM_SETTLE_MS);
    this.setView(zoomAt(this.view, this.view.zoom * Math.exp(-delta * WHEEL_ZOOM_SPEED), sx, sy));
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (this.drag || this.toolPointerId !== null) return;
    // A context click never reaches the tool: it opens the canvas's menu (contextmenu).
    const button = isContextClick(e, IS_APPLE) ? 2 : e.button;
    const isPan = button === 1 || (button === 0 && this.spaceHeld);
    if (!isPan && button !== 0) return;
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
      this.invalidateOverlay();
      return;
    }
    this.toolPointerId = e.pointerId;
    this.tools.pointerDown(this.toolEvent(e, e));
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
    this.tools.pointerMove(this.toolEvent(e, e));
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.drag) {
      if (e.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      this.releasePointer(e.pointerId);
      this.updateCursor();
      this.invalidateOverlay();
      return;
    }
    if (e.pointerId !== this.toolPointerId) return;
    this.toolPointerId = null;
    this.releasePointer(e.pointerId);
    this.trackPointer(e);
    this.tools.pointerUp(this.toolEvent(e, e));
    this.updateCursor();
    if (!this.pointerInside) this.forgetPointer();
  };

  private readonly handlePointerCancel = (e: PointerEvent): void => {
    if (this.drag?.pointerId === e.pointerId) {
      this.drag = null;
      this.updateCursor();
      this.invalidateOverlay();
    } else if (e.pointerId === this.toolPointerId) {
      this.cancelToolGesture();
    }
  };

  private readonly handlePointerEnter = (): void => {
    this.pointerInside = true;
    this.invalidateOverlay();
  };

  /** Follows the two clicks it ends; ignored while panning or mid-gesture. */
  private readonly handleDoubleClick = (e: MouseEvent): void => {
    if (e.button !== 0 || this.drag || this.spaceHeld || this.toolPointerId !== null) return;
    this.modifiers = modifiersOf(e);
    this.tools.doubleClick(this.toolEvent(e));
  };

  /**
   * Never lets the browser's menu show; asks for the canvas's own over the document,
   * unless a gesture or pan is in progress or a dialog is open.
   */
  private readonly handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.gate.blocked || this.drag || this.spaceHeld || this.toolPointerId !== null) return;
    const [x, y] = this.documentPoint(e);
    if (!isOnCanvas(this.editor.document, x, y)) return;
    for (const listener of [...this.contextMenuListeners]) listener({ x: e.clientX, y: e.clientY });
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerInside = false;
    this.invalidateOverlay();
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

  /**
   * The tool's view of a pointer at `point`. Given the browser event, adds pen pressure and,
   * for moves, the coalesced positions the pointer passed through since the last event.
   */
  private toolEvent(point: ClientPoint, e?: PointerEvent): ToolPointerEvent {
    const bounds = this.canvas.getBoundingClientRect();
    const [x, y] = this.documentPoint(point, bounds);
    const event: ToolPointerEvent = { x, y, zoom: this.view.zoom, ...this.modifiers };
    if (!e) return event;
    const pressure = penPressure(e);
    const coalesced = coalescedEvents(e);
    return {
      ...event,
      ...(pressure === undefined ? {} : { pressure }),
      ...(coalesced.length > 1 ? { samples: coalesced.map((c) => this.sample(c, bounds)) } : {}),
    };
  }

  private sample(e: PointerEvent, bounds: DOMRect): ToolPointerSample {
    const [x, y] = this.documentPoint(e, bounds);
    const pressure = penPressure(e);
    return pressure === undefined ? { x, y } : { x, y, pressure };
  }

  private documentPoint(
    point: ClientPoint,
    bounds = this.canvas.getBoundingClientRect(),
  ): [number, number] {
    return screenToDocument(this.view, point.clientX - bounds.left, point.clientY - bounds.top);
  }

  /**
   * Tells the tool where the pointer is after the document moved under it (pan or zoom) or
   * the tool changed. Only while the pointer is over the canvas or in a gesture.
   */
  private resendPointer(): void {
    if (!this.pointer || (this.toolPointerId === null && !this.pointerInside)) return;
    this.tools.pointerMove(this.toolEvent(this.pointer));
  }

  /** Keys go to the tool while the user is working on the canvas. */
  private toolWantsKeys(): boolean {
    return (
      this.toolPointerId !== null || this.pointerInside || document.activeElement === this.canvas
    );
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.modifiers = modifiersOf(e);
    // The pointer may still be over the canvas when a dialog opens; Enter, Escape and
    // Space must still reach the dialog. Nor is a key that something on the page has
    // already used (Escape closing a menu) the tool's.
    if (e.defaultPrevented || isTextEntry(e.target) || this.gate.blocked) return;
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
    if (isTextEntry(e.target) || this.gate.blocked) return;
    if (this.toolWantsKeys() && this.tools.keyUp(toolKeyEvent(e))) e.preventDefault();
  };

  private setSpaceHeld(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.updateCursor();
    this.invalidateOverlay();
  }

  private updateCursor(): void {
    let cursor = this.tools.cursor;
    if (this.drag) cursor = 'grabbing';
    else if (this.spaceHeld && this.toolPointerId === null) cursor = 'grab';
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    this.canvas.style.cursor = cursor;
  }

  private computeStatus(): ViewportStatus {
    let pointer: ViewportStatus['pointer'] = null;
    if (this.pointer) {
      const [x, y] = this.documentPoint(this.pointer);
      pointer = { x: Math.floor(x), y: Math.floor(y) };
    }
    const area =
      overlayArea(this.tools.overlay) ?? this.editor.document.selection?.bounds() ?? null;
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
    target: HTMLElement | Document | Window,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }
}
