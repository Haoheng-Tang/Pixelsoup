import type { ImageDocument } from './document';
import { createDocument, createLayerId } from './document';
import { assertNever, createRasterLayer } from './layer';

export type DocumentBackground = 'white' | 'transparent';

export interface NewDocumentOptions {
  /** Canvas size in pixels, 1 to MAX_IMAGE_SIZE. */
  width: number;
  height: number;
  background: DocumentBackground;
}

export const DEFAULT_NEW_DOCUMENT: Readonly<NewDocumentOptions> = {
  width: 1920,
  height: 1080,
  background: 'white',
};

/** A document with a single canvas-sized "Background" layer, opaque white or transparent. */
export function createBlankDocument(options: NewDocumentOptions): ImageDocument {
  const doc = createDocument(options.width, options.height);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: doc.width,
    height: doc.height,
  });
  switch (options.background) {
    case 'white':
      background.pixels.data.fill(255);
      break;
    case 'transparent':
      break;
    default:
      assertNever(options.background);
  }
  doc.layers.push(background);
  return doc;
}
