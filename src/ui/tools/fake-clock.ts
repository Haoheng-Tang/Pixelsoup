import type { FrameClock } from './frame-clock';

/** For tests: runs animation frames and tells the time only when a test says so. */
export class FakeClock implements FrameClock {
  time = 0;
  private readonly frames = new Map<number, () => void>();
  private nextHandle = 1;

  get pendingFrames(): number {
    return this.frames.size;
  }

  requestFrame(callback: () => void): number {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.frames.delete(handle);
  }

  now(): number {
    return this.time;
  }

  /** Runs the callbacks waiting for the next frame. */
  runFrame(): void {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback();
  }
}
