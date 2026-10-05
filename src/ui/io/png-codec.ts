import type { PngCodec } from '../../core';
import { decodeWithBrowser } from './image-decode';
import { UnsupportedPngError, decodePng, encodePng } from './png';

/**
 * The PNG codec injected into core serialization. Uses the exact pure codec, falling back
 * to the browser only for PNG variants it doesn't decode (Pixelsoup never writes those).
 */
export const pngCodec: PngCodec = {
  encode(pixels) {
    try {
      return Promise.resolve(encodePng(pixels));
    } catch (error) {
      return Promise.reject(asError(error));
    }
  },
  decode(png) {
    try {
      return Promise.resolve(decodePng(png));
    } catch (error) {
      if (error instanceof UnsupportedPngError) {
        return decodeWithBrowser(new Blob([png.slice()], { type: 'image/png' }));
      }
      return Promise.reject(asError(error));
    }
  },
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
