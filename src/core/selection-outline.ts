import { SELECTED_THRESHOLD } from './selection';
import type { Selection } from './selection';

/** The boundary of a selection, for drawing marching ants. */
export interface SelectionOutline {
  /**
   * Closed loops in document coordinates (pixel corners), each a flat list of corner
   * points [x0, y0, x1, y1, â€¦] that implicitly closes back to its first point. Loops
   * run with the selected side on their right (clockwise on screen around a region,
   * anticlockwise around a hole).
   */
  readonly loops: readonly (readonly number[])[];
  /** Number of one-pixel edges on the boundary. */
  readonly edgeCount: number;
}

// Directions in y-down document space: right, down, left, up. Adding 1 turns right
// (clockwise on screen).
const RIGHT = 0;
const DX: readonly number[] = [1, 0, -1, 0];
const DY: readonly number[] = [0, 1, 0, -1];

/**
 * Traces the edges between selected pixels (coverage of at least `SELECTED_THRESHOLD`,
 * i.e. more than 50%) and unselected ones into closed loops. Diagonally touching pixels
 * are traced as separate regions. Costs a pass over the selection's bounds, so compute it
 * once per selection change, not per frame.
 */
export function traceSelectionOutline(selection: Selection): SelectionOutline {
  const box = selection.bounds();
  if (!box) return { loops: [], edgeCount: 0 };
  const { width, mask } = selection;
  const threshold = SELECTED_THRESHOLD;

  // Every loop has rightward edges: tops of selected pixels whose upper neighbour isn't.
  // Start each loop from the first rightward edge, in raster order, that no loop has
  // used yet; its first vertex is always a corner.
  const visited = new Uint8Array(box.height * box.width);
  const loops: number[][] = [];
  let edgeCount = 0;
  for (let vy = box.y; vy < box.y + box.height; vy++) {
    const below = vy * width;
    const above = below - width;
    const visitedRow = (vy - box.y) * box.width - box.x;
    for (let vx = box.x; vx < box.x + box.width; vx++) {
      if (mask[below + vx] < threshold) continue;
      if (vy > 0 && mask[above + vx] >= threshold) continue;
      if (visited[visitedRow + vx]) continue;
      const points = [vx, vy];
      let x = vx;
      let y = vy;
      let dir = RIGHT;
      for (;;) {
        if (dir === RIGHT) visited[(y - box.y) * box.width + (x - box.x)] = 1;
        x += DX[dir];
        y += DY[dir];
        edgeCount++;
        const next = nextDirection(selection, x, y, dir);
        // A loop can pass its start vertex twice where pixels touch diagonally; it is
        // closed when the next edge would be the one it started with.
        if (x === vx && y === vy && next === RIGHT) break;
        if (next !== dir) points.push(x, y);
        dir = next;
      }
      loops.push(points);
    }
  }
  return { loops, edgeCount };
}

function isSelected(selection: Selection, px: number, py: number): boolean {
  const { width, height, mask } = selection;
  return (
    px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] >= SELECTED_THRESHOLD
  );
}

/**
 * Whether the boundary leaves vertex (vx, vy) in direction `dir`. Pixel (vx, vy) is the
 * one below-right of the vertex; boundary edges keep the selected pixel on their right.
 */
function leaves(selection: Selection, vx: number, vy: number, dir: number): boolean {
  switch (dir) {
    case 0:
      return isSelected(selection, vx, vy) && !isSelected(selection, vx, vy - 1);
    case 1:
      return isSelected(selection, vx - 1, vy) && !isSelected(selection, vx, vy);
    case 2:
      return isSelected(selection, vx - 1, vy - 1) && !isSelected(selection, vx - 1, vy);
    default:
      return isSelected(selection, vx, vy - 1) && !isSelected(selection, vx - 1, vy - 1);
  }
}

/**
 * The direction the boundary continues in after arriving at (vx, vy) heading `dir`.
 * Where two selected pixels touch only at a corner there are two ways out; turning
 * right first keeps each pixel with its own region.
 */
function nextDirection(selection: Selection, vx: number, vy: number, dir: number): number {
  const right = (dir + 1) & 3;
  if (leaves(selection, vx, vy, right)) return right;
  if (leaves(selection, vx, vy, dir)) return dir;
  const left = (dir + 3) & 3;
  if (leaves(selection, vx, vy, left)) return left;
  throw new Error(`Selection outline is broken at (${vx}, ${vy})`);
}
