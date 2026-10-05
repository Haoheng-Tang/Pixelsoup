import { unzlibSync, zlibSync } from 'fflate';
import type { PixelBuffer } from '../../core';
import { MAX_IMAGE_SIZE, isValidImageSize } from '../../core';

// A small pure-TypeScript PNG codec. It is used instead of canvas because canvases
// premultiply alpha, which rounds the colour of translucent pixels; this codec keeps
// straight-alpha RGBA8 exact. It encodes 8-bit RGBA only and decodes non-interlaced PNGs
// of every colour type and bit depth (16-bit samples are rounded to 8 bits). Interlaced
// images throw UnsupportedPngError so callers can fall back to the browser's decoder.

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const COLOR_GRAY = 0;
const COLOR_RGB = 2;
const COLOR_PALETTE = 3;
const COLOR_GRAY_ALPHA = 4;
const COLOR_RGBA = 6;

/** Samples per pixel, and the bit depths the PNG spec allows, for each colour type. */
const COLOR_TYPES: Readonly<
  Partial<Record<number, { channels: number; depths: readonly number[] }>>
> = {
  [COLOR_GRAY]: { channels: 1, depths: [1, 2, 4, 8, 16] },
  [COLOR_RGB]: { channels: 3, depths: [8, 16] },
  [COLOR_PALETTE]: { channels: 1, depths: [1, 2, 4, 8] },
  [COLOR_GRAY_ALPHA]: { channels: 2, depths: [8, 16] },
  [COLOR_RGBA]: { channels: 4, depths: [8, 16] },
};

/** A valid PNG that this codec doesn't decode (e.g. interlaced). */
export class UnsupportedPngError extends Error {
  override name = 'UnsupportedPngError';
}

export function imageTooLargeMessage(width: number, height: number): string {
  return (
    `The image is ${width}×${height} pixels; Pixelsoup supports images from 1×1 up to ` +
    `${MAX_IMAGE_SIZE}×${MAX_IMAGE_SIZE} pixels.`
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-32 (ISO 3309, as used by PNG and zip) of `bytes[start, end)`. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encodes straight-alpha RGBA8 pixels as an 8-bit RGBA PNG tagged as sRGB. */
export function encodePng(pixels: PixelBuffer): Uint8Array<ArrayBuffer> {
  const { width, height } = pixels;
  if (!isValidImageSize(width, height)) throw new RangeError(imageTooLargeMessage(width, height));

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = COLOR_RGBA;
  // compression, filter method and interlace are all 0.

  const imageData = zlibSync(filterRows(pixels), { level: 6 });
  const chunks: [string, Uint8Array][] = [
    ['IHDR', header],
    ['sRGB', Uint8Array.of(0)], // perceptual rendering intent
    ['IDAT', imageData],
    ['IEND', new Uint8Array()],
  ];

  let size = SIGNATURE.length;
  for (const [, data] of chunks) size += 12 + data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE);
  let pos = SIGNATURE.length;
  for (const [type, data] of chunks) {
    view.setUint32(pos, data.length);
    for (let i = 0; i < 4; i++) out[pos + 4 + i] = type.charCodeAt(i);
    out.set(data, pos + 8);
    view.setUint32(pos + 8 + data.length, crc32(out, pos + 4, pos + 8 + data.length));
    pos += 12 + data.length;
  }
  return out;
}

/**
 * Prefixes each row with the PNG filter that minimises the sum of absolute (signed)
 * filtered bytes, the heuristic recommended by the PNG spec.
 */
function filterRows({ width, height, data }: PixelBuffer): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    const hasPrev = y > 0;

    // Score all five filters in one pass. Each filtered byte counts by its magnitude as a
    // signed value, so 255 (-1) is as cheap as 1.
    let none = 0;
    let sub = 0;
    let up = 0;
    let avg = 0;
    let paeth = 0;
    for (let i = 0; i < stride; i++) {
      const x = data[row + i];
      const a = i >= 4 ? data[row + i - 4] : 0;
      const b = hasPrev ? data[prev + i] : 0;
      const c = hasPrev && i >= 4 ? data[prev + i - 4] : 0;
      none += magnitude(x);
      sub += magnitude(x - a);
      up += magnitude(x - b);
      avg += magnitude(x - ((a + b) >> 1));
      paeth += magnitude(x - paethPredictor(a, b, c));
    }
    let filter = 0;
    let best = none;
    if (sub < best) {
      filter = 1;
      best = sub;
    }
    if (up < best) {
      filter = 2;
      best = up;
    }
    if (avg < best) {
      filter = 3;
      best = avg;
    }
    if (paeth < best) filter = 4;

    const target = y * (stride + 1);
    out[target] = filter;
    // Uint8Array stores values modulo 256, which is the arithmetic PNG filters use.
    for (let i = 0; i < stride; i++) {
      const x = data[row + i];
      const a = i >= 4 ? data[row + i - 4] : 0;
      const b = hasPrev ? data[prev + i] : 0;
      const c = hasPrev && i >= 4 ? data[prev + i - 4] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) predicted = paethPredictor(a, b, c);
      out[target + 1 + i] = x - predicted;
    }
  }
  return out;
}

function magnitude(difference: number): number {
  const byte = difference & 0xff;
  return byte < 128 ? byte : 256 - byte;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

interface PngHeader {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  channels: number;
}

/**
 * Decodes a PNG into straight-alpha RGBA8 pixels.
 * Throws UnsupportedPngError for valid PNGs it can't decode, and Error for damaged data.
 */
export function decodePng(bytes: Uint8Array): PixelBuffer {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('Not a PNG image.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: PngHeader | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const imageData: Uint8Array[] = [];

  for (let pos = SIGNATURE.length; ;) {
    if (pos + 12 > bytes.length) {
      // Like browsers, tolerate a missing IEND once there is image data.
      if (imageData.length > 0) break;
      throw new Error('The PNG is truncated.');
    }
    const length = view.getUint32(pos);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('The PNG is truncated.');
    const type = String.fromCharCode(...bytes.subarray(pos + 4, dataStart));
    // Bit 5 of the first type byte is clear for critical chunks.
    const critical = (bytes[pos + 4] & 0x20) === 0;
    if (critical || type === 'tRNS') {
      if (crc32(bytes, pos + 4, dataEnd) !== view.getUint32(dataEnd)) {
        throw new Error(`The PNG is damaged (bad ${type} checksum).`);
      }
    }
    const data = bytes.subarray(dataStart, dataEnd);
    pos = dataEnd + 4;

    if (!header && type !== 'IHDR') throw new Error('The PNG has no header.');
    if (type === 'IHDR') header = parseHeader(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') break;
    else if (critical) throw new UnsupportedPngError(`Unknown critical PNG chunk ${type}.`);
  }
  if (!header) throw new Error('The PNG has no header.');
  if (imageData.length === 0) throw new Error('The PNG has no image data.');
  if (header.colorType === COLOR_PALETTE && !palette) throw new Error('The PNG has no palette.');

  const rowBytes = Math.ceil((header.width * header.channels * header.depth) / 8);
  const raw = inflate(imageData, header.height * (rowBytes + 1));
  unfilter(raw, header, rowBytes);
  return toRgba(raw, header, rowBytes, palette, transparency);
}

function parseHeader(data: Uint8Array): PngHeader {
  if (data.length !== 13) throw new Error('The PNG header is damaged.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [depth, colorType, compression, filterMethod, interlace] = data.subarray(8);
  const format = COLOR_TYPES[colorType];
  if (!format?.depths.includes(depth) || compression !== 0 || filterMethod !== 0) {
    throw new Error('The PNG header is damaged.');
  }
  if (interlace === 1) throw new UnsupportedPngError('Interlaced PNGs are not supported.');
  if (interlace !== 0) throw new Error('The PNG header is damaged.');
  if (!isValidImageSize(width, height)) throw new RangeError(imageTooLargeMessage(width, height));
  return { width, height, depth, colorType, channels: format.channels };
}

function inflate(chunks: readonly Uint8Array[], expectedLength: number): Uint8Array {
  let compressed = chunks[0];
  if (chunks.length > 1) {
    compressed = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch {
    throw new Error('The PNG image data is damaged.');
  }
  if (raw.length < expectedLength) throw new Error('The PNG image data is truncated.');
  return raw;
}

/** Reverses the per-row filters in place, leaving each row's filter-type byte. */
function unfilter(raw: Uint8Array, { height, channels, depth }: PngHeader, rowBytes: number) {
  // Filters operate on whole bytes; pixels narrower than a byte use the previous byte.
  const bpp = Math.max(1, (channels * depth) >> 3);
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1;
    const prev = row - (rowBytes + 1);
    const hasPrev = y > 0;
    const filter = raw[row - 1];
    // Uint8Array stores values modulo 256, which is the arithmetic PNG filters use.
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < rowBytes; i++) raw[row + i] += raw[row + i - bpp];
        break;
      case 2:
        if (hasPrev) for (let i = 0; i < rowBytes; i++) raw[row + i] += raw[prev + i];
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? raw[row + i - bpp] : 0;
          const b = hasPrev ? raw[prev + i] : 0;
          raw[row + i] += (a + b) >> 1;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? raw[row + i - bpp] : 0;
          const b = hasPrev ? raw[prev + i] : 0;
          const c = hasPrev && i >= bpp ? raw[prev + i - bpp] : 0;
          raw[row + i] += paethPredictor(a, b, c);
        }
        break;
      default:
        throw new Error('The PNG image data is damaged (unknown row filter).');
    }
  }
}

function toRgba(
  raw: Uint8Array,
  { width, height, depth, colorType, channels }: PngHeader,
  rowBytes: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): PixelBuffer {
  const out = new Uint8ClampedArray(width * height * 4);
  if (colorType === COLOR_RGBA && depth === 8) {
    for (let y = 0; y < height; y++) {
      const row = y * (rowBytes + 1) + 1;
      out.set(raw.subarray(row, row + rowBytes), y * width * 4);
    }
    return { width, height, data: out };
  }

  // tRNS for grey and RGB images names one colour (as raw samples) that is transparent.
  const key =
    transparency && colorType !== COLOR_PALETTE
      ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength)
      : null;
  const grayKey = key && key.byteLength >= 2 ? key.getUint16(0) : -1;
  const hasRgbKey = key !== null && key.byteLength >= 6;
  const redKey = hasRgbKey ? key.getUint16(0) : -1;
  const greenKey = hasRgbKey ? key.getUint16(2) : -1;
  const blueKey = hasRgbKey ? key.getUint16(4) : -1;

  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const s = x * channels;
      switch (colorType) {
        case COLOR_GRAY: {
          const v = sample(raw, row, s, depth);
          out[o] = out[o + 1] = out[o + 2] = to8Bit(v, depth);
          out[o + 3] = v === grayKey ? 0 : 255;
          break;
        }
        case COLOR_RGB: {
          const r = sample(raw, row, s, depth);
          const g = sample(raw, row, s + 1, depth);
          const b = sample(raw, row, s + 2, depth);
          out[o] = to8Bit(r, depth);
          out[o + 1] = to8Bit(g, depth);
          out[o + 2] = to8Bit(b, depth);
          out[o + 3] = r === redKey && g === greenKey && b === blueKey ? 0 : 255;
          break;
        }
        case COLOR_PALETTE: {
          const index = sample(raw, row, s, depth);
          if (!palette || index * 3 + 2 >= palette.length) {
            throw new Error('The PNG refers to a colour outside its palette.');
          }
          out[o] = palette[index * 3];
          out[o + 1] = palette[index * 3 + 1];
          out[o + 2] = palette[index * 3 + 2];
          out[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
          break;
        }
        case COLOR_GRAY_ALPHA: {
          out[o] = out[o + 1] = out[o + 2] = to8Bit(sample(raw, row, s, depth), depth);
          out[o + 3] = to8Bit(sample(raw, row, s + 1, depth), depth);
          break;
        }
        case COLOR_RGBA: {
          for (let k = 0; k < 4; k++) out[o + k] = to8Bit(sample(raw, row, s + k, depth), depth);
          break;
        }
        default:
          throw new Error('The PNG header is damaged.');
      }
    }
  }
  return { width, height, data: out };
}

/** The `index`th sample of the row starting at `row`, as its raw integer value. */
function sample(raw: Uint8Array, row: number, index: number, depth: number): number {
  if (depth === 8) return raw[row + index];
  if (depth === 16) return (raw[row + index * 2] << 8) | raw[row + index * 2 + 1];
  const bit = index * depth;
  const shift = 8 - depth - (bit & 7);
  return (raw[row + (bit >> 3)] >> shift) & ((1 << depth) - 1);
}

/** Scales a sample to 0–255; 16-bit values are rounded to the nearest 8-bit value. */
function to8Bit(value: number, depth: number): number {
  if (depth === 8) return value;
  if (depth === 16) return Math.floor((value + 128) / 257);
  return (value * 255) / ((1 << depth) - 1);
}
