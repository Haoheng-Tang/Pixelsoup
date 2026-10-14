import { SELECTED_THRESHOLD, Selection } from './selection';

/** The boundary of a selection, for drawing marching ants. */
export interface SelectionOutline {
  /**
   * Closed loops in document coordinates (pixel corners), each a flat list of corner
   * points [x0, y0, x1, y1, …] that implicitly closes back to its first point. Loops
   * run with the selected side on their right (clockwise on screen around a region,
   * anticlockwise around a hole).
   */
  readonly loops: readonly (readonly number[])[];
  /** Total length of the loops in canvas pixels: at full resolution, the one-pixel edges. */
  readonly edgeCount: number;
}

/** The length of a loop (horizontal and vertical edges only), closing edge included. */
export function loopLength(loop: readonly number[]): number {
  if (loop.length < 4) return 0;
  let length = 0;
  let x = loop[loop.length - 2];
  let y = loop[loop.length - 1];
  for (let i = 0; i < loop.length; i += 2) {
    length += Math.abs(loop[i] - x) + Math.abs(loop[i + 1] - y);
    x = loop[i];
    y = loop[i + 1];
  }
  return length;
}

/**
 * `selection` at 1/`cell` of its resolution, for outlines at screen resolution when zoomed
 * out. Each `cell` × `cell` block of canvas pixels, counted from the canvas's top-left,
 * becomes one pixel: selected (255) when the block's average coverage is more than half, as
 * `SELECTED_THRESHOLD` is for a single pixel, else 0. Blocks cut short by the canvas's right
 * and bottom edges average what's left of them. A cell of 1 gives the selection itself.
 */
export function downsampleSelection(selection: Selection, cell: number): Selection {
  if (!Number.isInteger(cell) || cell < 1) {
    throw new RangeError(`Cell size must be a positive integer, got ${cell}`);
  }
  if (cell === 1) return selection;
  const { width, height, mask } = selection;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const coarse = new Uint8ClampedArray(columns * rows);
  const box = selection.bounds();
  if (box) {
    // Only blocks overlapping the bounds can be selected, and pixels outside them are 0.
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const first = Math.floor(box.x / cell);
    const last = Math.ceil(right / cell);
    const sums = new Uint32Array(last - first);
    for (let row = Math.floor(box.y / cell); row < Math.ceil(bottom / cell); row++) {
      sums.fill(0);
      const top = row * cell;
      for (let y = Math.max(top, box.y); y < Math.min(top + cell, bottom); y++) {
        const offset = y * width;
        for (let column = first; column < last; column++) {
          const end = offset + Math.min(column * cell + cell, right);
          let sum = 0;
          for (let i = offset + Math.max(column * cell, box.x); i < end; i++) sum += mask[i];
          sums[column - first] += sum;
        }
      }
      const blockHeight = Math.min(cell, height - top);
      for (let column = first; column < last; column++) {
        const area = Math.min(cell, width - column * cell) * blockHeight;
        if (2 * sums[column - first] > 255 * area) coarse[row * columns + column] = 255;
      }
    }
  }
  return Selection.fromMask(columns, rows, coarse);
}

/**
 * The outline of `selection` at 1/`cell` of its resolution (`downsampleSelection`), for
 * marching ants at screen resolution, in canvas coordinates: corners lie on multiples of
 * `cell`, or on the canvas's right and bottom edges where the last blocks are cut short. For
 * a cell of 1 it's `traceSelectionOutline`'s.
 */
export function traceDownsampledOutline(selection: Selection, cell: number): SelectionOutline {
  const outline = traceSelectionOutline(downsampleSelection(selection, cell));
  if (cell === 1) return outline;
  const { width, height } = selection;
  let edgeCount = 0;
  const loops = outline.loops.map((loop) => {
    const points = new Array<number>(loop.length);
    for (let i = 0; i < loop.length; i += 2) {
      points[i] = Math.min(loop[i] * cell, width);
      points[i + 1] = Math.min(loop[i + 1] * cell, height);
    }
    edgeCount += loopLength(points);
    return points;
  });
  return { loops, edgeCount };
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
