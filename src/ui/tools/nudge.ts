/** Arrow-key nudges this close together, in milliseconds, become one undo step. */
export const NUDGE_MERGE_MS = 1000;

/** Pixels an arrow key nudges by: 1, or 10 with Shift. Null for keys that aren't arrows. */
export function nudgeOffset(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

// Shared by every grouper, so two never hand out the same key.
let runs = 0;

/**
 * Hands out merge keys for nudges: each nudge less than `windowMs` after the previous one
 * gets the same key, so a run of quick nudges merges into one undo step.
 */
export class NudgeGrouper {
  private key = '';
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowMs = NUDGE_MERGE_MS) {}

  /** The merge key for a nudge made at time `now`, in milliseconds. */
  keyAt(now: number): string {
    if (!(now - this.last < this.windowMs)) this.key = `nudge:${++runs}`;
    this.last = now;
    return this.key;
  }

  /** Makes the next nudge start a new undo step, however soon it comes. */
  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}
