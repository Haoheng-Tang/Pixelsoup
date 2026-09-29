/**
 * Maps document pixels to viewport CSS pixels: `screen = doc * zoom + pan`.
 * Pure functions only, so the math is unit-testable without a DOM.
 */
export interface ViewTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Changes zoom while keeping the document point under screen point (sx, sy) fixed. */
export function zoomAt(view: ViewTransform, zoom: number, sx: number, sy: number): ViewTransform {
  const next = clampZoom(zoom);
  const ratio = next / view.zoom;
  return {
    zoom: next,
    panX: sx - (sx - view.panX) * ratio,
    panY: sy - (sy - view.panY) * ratio,
  };
}

/** Centers a document of the given size in the viewport at `zoom`. */
export function centered(
  zoom: number,
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
): ViewTransform {
  const z = clampZoom(zoom);
  return {
    zoom: z,
    panX: Math.round((viewWidth - docWidth * z) / 2),
    panY: Math.round((viewHeight - docHeight * z) / 2),
  };
}

/** Largest zoom (capped at `maxZoom`) that fits the document inside the viewport with padding. */
export function fitZoom(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  padding = 24,
  maxZoom = 1,
): number {
  const availableW = Math.max(1, viewWidth - padding * 2);
  const availableH = Math.max(1, viewHeight - padding * 2);
  return clampZoom(Math.min(maxZoom, availableW / docWidth, availableH / docHeight));
}

export function screenToDocument(view: ViewTransform, sx: number, sy: number): [number, number] {
  return [(sx - view.panX) / view.zoom, (sy - view.panY) / view.zoom];
}

/** Zoom presets used by the zoom in / zoom out commands. */
const ZOOM_STEPS = [
  0.01, 0.02, 0.03, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8,
  12, 16, 24, 32, 48, 64,
];

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + epsilon) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - epsilon) ?? MIN_ZOOM;
}
