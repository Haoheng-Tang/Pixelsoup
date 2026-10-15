import type { FileType } from '../io/file-store';

export const PIXELSOUP_MIME_TYPE = 'application/x-pixelsoup';
export const PIXELSOUP_EXTENSION = '.soup';

export const PIXELSOUP_FILE_TYPE: FileType = {
  description: 'Pixelsoup document',
  accept: { [PIXELSOUP_MIME_TYPE]: [PIXELSOUP_EXTENSION] },
};

export const IMAGE_FILE_TYPE: FileType = {
  description: 'Image (PNG, JPEG, WebP)',
  accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] },
};

/** What Open offers: everything it can read first, then each kind on its own. */
export const OPEN_FILE_TYPES: readonly FileType[] = [
  {
    description: 'Pixelsoup documents and images',
    accept: { [PIXELSOUP_MIME_TYPE]: [PIXELSOUP_EXTENSION], ...IMAGE_FILE_TYPE.accept },
  },
  PIXELSOUP_FILE_TYPE,
  IMAGE_FILE_TYPE,
];

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportFormatInfo {
  readonly label: string;
  readonly mimeType: string;
  readonly extension: string;
  /** Lossy formats take a quality setting. */
  readonly lossy: boolean;
  /** Formats without alpha are flattened onto white. */
  readonly alpha: boolean;
}

export const EXPORT_FORMATS: Readonly<Record<ExportFormat, ExportFormatInfo>> = {
  png: { label: 'PNG', mimeType: 'image/png', extension: '.png', lossy: false, alpha: true },
  jpeg: { label: 'JPEG', mimeType: 'image/jpeg', extension: '.jpg', lossy: true, alpha: false },
  webp: { label: 'WebP', mimeType: 'image/webp', extension: '.webp', lossy: true, alpha: true },
};

export interface ExportOptions {
  readonly format: ExportFormat;
  /** 0–1; used by lossy formats only. */
  readonly quality: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { format: 'png', quality: 0.9 };

export function exportFileType(format: ExportFormat): FileType {
  const { label, mimeType, extension } = EXPORT_FORMATS[format];
  return { description: `${label} image`, accept: { [mimeType]: [extension] } };
}
