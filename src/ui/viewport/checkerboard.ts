const CHECKER_LIGHT = '#ffffff';
const CHECKER_DARK = '#cccccc';
/** Checkerboard square size in CSS pixels (constant on screen regardless of zoom). */
const CHECKER_SIZE = 8;

/**
 * The transparency checkerboard as a repeating pattern of `CHECKER_SIZE` CSS pixel squares
 * at `dpr` device pixels per CSS pixel, or a flat colour if a pattern can't be made. Anchor
 * it to the document origin with `setTransform` so every drawing of it lines up.
 */
export function createCheckerPattern(
  context: CanvasRenderingContext2D,
  dpr: number,
): CanvasPattern | string {
  const size = Math.max(1, Math.round(CHECKER_SIZE * dpr));
  const tile = document.createElement('canvas');
  tile.width = tile.height = size * 2;
  const tctx = tile.getContext('2d');
  if (!tctx) return CHECKER_LIGHT;
  tctx.fillStyle = CHECKER_LIGHT;
  tctx.fillRect(0, 0, size * 2, size * 2);
  tctx.fillStyle = CHECKER_DARK;
  tctx.fillRect(size, 0, size, size);
  tctx.fillRect(0, size, size, size);
  return context.createPattern(tile, 'repeat') ?? CHECKER_LIGHT;
}
