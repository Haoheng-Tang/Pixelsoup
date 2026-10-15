import type { PixelBuffer } from '../../core';
import { encodePng } from '../io/png';

/**
 * Puts `pixels` on the system clipboard as a PNG, straight alpha and exact (the browser
 * may re-encode it), so other apps can paste them. Resolves to false where the browser
 * can't write images (no `ClipboardItem`, as in Firefox before 127) or refuses (the page
 * isn't focused, or permission is denied); it never rejects.
 *
 * `write` is called straight away, within the click or key press that copied, which
 * Safari requires; the PNG is encoded on a later task so the copy itself stays quick.
 */
export function writeImageToSystemClipboard(pixels: PixelBuffer): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (typeof ClipboardItem === 'undefined' || typeof clipboard?.write !== 'function') {
    return Promise.resolve(false);
  }
  const png = new Promise<Blob>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(new Blob([encodePng(pixels)], { type: 'image/png' }));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 0);
  });
  try {
    return clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
