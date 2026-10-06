import type { PixelBuffer } from '../../core';
import { isValidImageSize } from '../../core';
import { decodePng, imageTooLargeMessage } from './png';

/** Raised when a file can't be decoded as an image. */
export class ImageDecodeError extends Error {
  override name = 'ImageDecodeError';
}

/**
 * Decodes an image file (PNG, JPEG, WebP, or anything else the browser supports) to
 * straight-alpha RGBA8. Colour profiles are ignored and the values treated as sRGB.
 *
 * PNGs go through the exact pure decoder where possible. Other formats use the browser,
 * which draws through a premultiplied canvas: opaque pixels are exact, but translucent
 * ones may lose some colour precision.
 */
export async function decodeImageFile(file: Blob): Promise<PixelBuffer> {
  if (isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
    try {
      return decodePng(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof RangeError) throw error;
      // Otherwise let the browser try; it handles interlacing and is more lenient.
    }
  }
  return decodeWithBrowser(file);
}

function isPng(header: Uint8Array): boolean {
  return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte);
}

/** Decodes with the browser's image codecs. See `decodeImageFile` for the precision caveat. */
export async function decodeWithBrowser(file: Blob): Promise<PixelBuffer> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      imageOrientation: 'from-image',
    });
  } catch {
    throw new ImageDecodeError(
      'The file could not be read as an image. Pixelsoup can open PNG, JPEG and WebP images.',
    );
  }
  try {
    const { width, height } = bitmap;
    if (!isValidImageSize(width, height)) throw new RangeError(imageTooLargeMessage(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser could not create a canvas to decode the image.');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}
