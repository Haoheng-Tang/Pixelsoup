/** The timing tools rely on; tests pass a `FakeClock` to run frames by hand. */
export interface FrameClock {
  /** Runs `callback` once before the next repaint, like requestAnimationFrame. */
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** Milliseconds, e.g. to group arrow-key nudges. */
  now(): number;
}

export const browserClock: FrameClock = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};
