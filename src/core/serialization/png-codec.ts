import type { PixelBuffer } from '../pixel-buffer';

/**
 * Encodes and decodes the PNG images that hold raster layer pixels in .soup files.
 * Injected by the UI so core needs no image APIs.
 *
 * Implementations must be lossless: `decode(await encode(p))` returns exactly the
 * straight-alpha RGBA values of `p` (canvas-based codecs are not, because canvases
 * premultiply alpha).
 */
export interface PngCodec {
  encode(pixels: PixelBuffer): Promise<Uint8Array>;
  /** Rejects if `png` is not a PNG it can decode. */
  decode(png: Uint8Array): Promise<PixelBuffer>;
}
