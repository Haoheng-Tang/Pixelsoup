/**
 * Drawing large images shrunk, smoothly and cheaply. Chromium draws a canvas with mipmapped
 * smoothing ('medium') by making a mipmapped copy of it every time, which costs tens of
 * milliseconds a frame for a 6400 × 4000 canvas. A pyramid keeps copies of the image at a
 * half, a quarter, … of its size instead, each made once, when first needed, and draws the
 * smallest copy that's still at least as large as the result with plain bilinear filtering
 * ('low'), which looks much the same.
 */

/** Draws `source` (at any size) into a new image of `width` × `height`. */
export type ShrinkImage = (
  source: CanvasImageSource,
  width: number,
  height: number,
) => CanvasImageSource;

/** One level of a pyramid: the image, or a copy at 2^-k of its size, rounded up. */
interface PyramidLevel {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/**
 * Which level of a pyramid to draw a `width` × `height` image from, to show it at `scale`
 * times its size: the smallest copy no smaller than that, where level k is 2^-k of the size,
 * rounded up, down to 1 × 1. Level 0 is the image itself, used above half its size.
 */
export function pyramidLevel(width: number, height: number, scale: number): number {
  let level = 0;
  let w = width;
  let h = height;
  while ((w > 1 || h > 1) && scale <= 0.5 ** (level + 1)) {
    level++;
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
  }
  return level;
}

/**
 * The scale at which a transform with linear part (a, b, c, d), in canvas `setTransform`
 * order, draws an image, for `CanvasPyramid.at`: the lesser of how far it stretches the
 * image's x axis and its y axis, as a mipmap would pick its level.
 */
export function drawScale(a: number, b: number, c: number, d: number): number {
  return Math.min(Math.hypot(a, b), Math.hypot(c, d));
}

/** An image and its smaller copies, made as they're first needed. */
export class CanvasPyramid {
  private readonly levels: PyramidLevel[];

  constructor(
    readonly base: CanvasImageSource,
    readonly width: number,
    readonly height: number,
    private readonly shrink: ShrinkImage = shrinkCanvas,
  ) {
    this.levels = [{ image: base, width, height }];
  }

  /**
   * What to draw, stretched to the image's size, to show it at `scale` times its size: the
   * image itself from half its size up, else the smallest copy at least that large.
   */
  at(scale: number): CanvasImageSource {
    const wanted = pyramidLevel(this.width, this.height, scale);
    while (this.levels.length <= wanted) {
      const top = this.levels[this.levels.length - 1];
      const width = Math.ceil(top.width / 2);
      const height = Math.ceil(top.height / 2);
      this.levels.push({ image: this.shrink(top.image, width, height), width, height });
    }
    return this.levels[wanted].image;
  }
}

/** A new canvas holding `source` drawn at `width` × `height`. */
function shrinkCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');
  // At half the size, bilinear filtering averages each 2 × 2 block, as a mipmap does.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'low';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}
