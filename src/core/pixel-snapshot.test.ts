import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from './pixel-buffer';
import { createPixelBuffer, fillRect } from './pixel-buffer';
import { PixelSnapshot } from './pixel-snapshot';

/** A buffer whose every byte differs from its neighbours, so misplaced bytes show. */
function patterned(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  buffer.data.forEach((_, i) => (buffer.data[i] = (i * 37 + 11) % 256));
  return buffer;
}

describe('PixelSnapshot', () => {
  it('restores the exact bytes of its rect and leaves the rest alone', () => {
    const buffer = patterned(5, 4);
    const original = buffer.data.slice();
    const snapshot = PixelSnapshot.capture(buffer, { x: 1, y: 1, width: 3, height: 2 });
    expect(snapshot.rect).toEqual({ x: 1, y: 1, width: 3, height: 2 });

    buffer.data.fill(7);
    snapshot.restore(buffer);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        const inside = x >= 1 && x < 4 && y >= 1 && y < 3;
        const i = (y * 5 + x) * 4;
        const expected = inside ? [...original.subarray(i, i + 4)] : [7, 7, 7, 7];
        expect([...buffer.data.subarray(i, i + 4)]).toEqual(expected);
      }
    }
  });

  it('keeps its own copy, unaffected by later edits', () => {
    const buffer = patterned(3, 3);
    const original = buffer.data.slice();
    const snapshot = PixelSnapshot.capture(buffer, { x: 0, y: 0, width: 3, height: 3 });
    fillRect(buffer, { x: 0, y: 0, width: 3, height: 3 }, [1, 2, 3, 4]);
    snapshot.restore(buffer);
    expect(buffer.data).toEqual(original);
    // Restoring twice is harmless.
    snapshot.restore(buffer);
    expect(buffer.data).toEqual(original);
  });

  it('clips the rect to the buffer', () => {
    const buffer = patterned(4, 4);
    const original = buffer.data.slice();
    const snapshot = PixelSnapshot.capture(buffer, { x: -2, y: 2, width: 4, height: 9 });
    expect(snapshot.rect).toEqual({ x: 0, y: 2, width: 2, height: 2 });
    buffer.data.fill(0);
    snapshot.restore(buffer);
    expect(buffer.data.subarray(32, 40)).toEqual(original.subarray(32, 40));
    expect(buffer.data.subarray(40, 48)).toEqual(new Uint8ClampedArray(8));
  });

  it('copies nothing for a rect outside the buffer', () => {
    const buffer = patterned(2, 2);
    const snapshot = PixelSnapshot.capture(buffer, { x: 5, y: 0, width: 2, height: 2 });
    expect(snapshot.rect).toBeNull();
    const before = buffer.data.slice();
    snapshot.restore(buffer);
    expect(buffer.data).toEqual(before);
  });

  it('refuses to restore into a buffer of another size', () => {
    const snapshot = PixelSnapshot.capture(patterned(4, 4), { x: 0, y: 0, width: 2, height: 2 });
    expect(() => snapshot.restore(createPixelBuffer(4, 5))).toThrow(/4x4/);
  });
});
