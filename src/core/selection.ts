/**
 * A selection is an 8-bit coverage mask the size of the canvas:
 * 0 = not selected, 255 = fully selected, values in between = partially selected
 * (feathered / anti-aliased edges). Row-major, one byte per canvas pixel.
 *
 * Reserved for the upcoming selection tools; nothing creates selections yet.
 */
export interface Selection {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array<ArrayBuffer>;
}

export function createSelection(width: number, height: number): Selection {
  return { width, height, mask: new Uint8Array(width * height) };
}
