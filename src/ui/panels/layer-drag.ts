// Pure geometry for reordering layer rows by dragging. Rows list the layers top first,
// so row r shows stack index count − 1 − r.

/** Pointer travel in CSS pixels before a press on a layer row becomes a drag. */
export const DRAG_THRESHOLD = 4;

/**
 * The gap a row dragged to `y` would drop into, given the rows' vertical midpoints from
 * the top: 0 is above the first row and `midpoints.length` below the last.
 */
export function dropSlot(midpoints: readonly number[], y: number): number {
  let slot = 0;
  while (slot < midpoints.length && y > midpoints[slot]) slot++;
  return slot;
}

/** True if dropping the row at `fromRow` into the gap `slot` would leave it where it is. */
export function isNoOpDrop(fromRow: number, slot: number): boolean {
  return slot === fromRow || slot === fromRow + 1;
}

/** Stack index (0 = bottom) that dropping the row at `fromRow` into `slot` moves its layer to. */
export function stackIndexForDrop(count: number, fromRow: number, slot: number): number {
  const row = slot > fromRow ? slot - 1 : slot;
  return count - 1 - row;
}
