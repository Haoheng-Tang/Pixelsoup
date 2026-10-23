import { multiply, rotation, transformPoint, translation } from '../../core';

/** The cursors made so far, by what they show. */
const cursors = new Map<string, string>();

/**
 * A cursor drawn as a 24 px SVG with its hot spot at `hotX`, `hotY`. Free Transform's are
 * black with a white edge, or white with a black one, so they show on any colour.
 */
function svgCursor(key: string, body: string, hotX: number, hotY: number): string {
  let cursor = cursors.get(key);
  if (cursor) return cursor;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
  cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, default`;
  cursors.set(key, cursor);
  return cursor;
}

/**
 * A curved double arrow, bent round a south-east corner and turned `degrees` clockwise
 * about the middle of its 24 px square: what a press does in the rotate zone.
 */
export function rotateCursor(degrees: number): string {
  const arc = 'M13.97 5.78A9 9 0 0 1 5.78 13.97';
  const heads = 'M14.32 1.8L17.46 6.08L10.48 5.48ZM1.8 14.32L6.09 17.46L5.48 10.48Z';
  const body =
    `<g transform="rotate(${degrees} 12 12)" stroke-linejoin="round">` +
    `<path d="${arc}" fill="none" stroke="white" stroke-width="4"/>` +
    `<path d="${heads}" fill="white" stroke="white" stroke-width="2.5"/>` +
    `<path d="${arc}" fill="none" stroke="black" stroke-width="1.5"/>` +
    `<path d="${heads}" fill="black"/></g>`;
  // The hot spot is the middle of the arc, (11.36, 11.36) before the turn.
  const [hx, hy] = transformPoint(
    multiply(translation(12, 12), multiply(rotation(degrees), translation(-12, -12))),
    11.36,
    11.36,
  );
  return svgCursor(`rotate ${degrees}`, body, Math.round(hx), Math.round(hy));
}

/** A white arrowhead pointing up and left, its tip the hot spot, with a badge below it. */
function arrowheadCursor(key: string, badge: string): string {
  const arrowhead =
    '<path d="M4 3L4 17L7.6 13.6L13 13.6Z" fill="white" stroke="black" ' +
    'stroke-width="1.2" stroke-linejoin="round"/>';
  return svgCursor(key, arrowhead + badge, 4, 3);
}

/** A badge drawn black over a wider white line. */
function outlined(d: string): string {
  return (
    `<path d="${d}" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** Distort: the arrowhead with a lopsided four-sided badge. */
export function distortCursor(): string {
  return arrowheadCursor('distort', outlined('M13.5 15.5L21.5 14L21 21.5L15 20.5Z'));
}

/** Perspective: the arrowhead with a trapezoid badge. */
export function perspectiveCursor(): string {
  return arrowheadCursor('perspective', outlined('M15.5 15H20L22 21H13.5Z'));
}

/**
 * Skew: the arrowhead with a double arrow turned `degrees` clockwise from east, along the
 * edge that slides.
 */
export function skewCursor(degrees: number): string {
  const arrow =
    'M13 18.5H22M13 18.5L15.2 16.3M13 18.5L15.2 20.7M22 18.5L19.8 16.3M22 18.5L19.8 20.7';
  return arrowheadCursor(
    `skew ${degrees}`,
    `<g transform="rotate(${degrees} 17.5 18.5)">${outlined(arrow)}</g>`,
  );
}
