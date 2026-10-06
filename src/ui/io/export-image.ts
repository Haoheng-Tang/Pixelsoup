import type { PixelBuffer } from '../../core';
import { assertNever } from '../../core';
import type { ExportOptions } from '../session/file-types';
import { EXPORT_FORMATS } from '../session/file-types';
import { encodePng } from './png';

/**
 * Encodes flattened pixels for export. PNG uses the exact pure encoder; JPEG and WebP use
 * the browser's encoders via canvas (JPEG input must already be opaque, see flattenOnto).
 */
export async function encodeImage(pixels: PixelBuffer, options: ExportOptions): Promise<Blob> {
  const { format } = options;
  switch (format) {
    case 'png':
      return new Blob([encodePng(pixels)], { type: EXPORT_FORMATS.png.mimeType });
    case 'jpeg':
    case 'webp':
      return encodeWithCanvas(pixels, options);
    default:
      return assertNever(format);
  }
}

async function encodeWithCanvas(pixels: PixelBuffer, { format, quality }: ExportOptions) {
  const { label, mimeType } = EXPORT_FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create a canvas to encode the image.');
  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
  // Browsers without an encoder for the type silently fall back to PNG.
  if (!blob || blob.type !== mimeType) {
    throw new Error(`This browser can't create ${label} images. Try exporting as PNG.`);
  }
  return blob;
}
