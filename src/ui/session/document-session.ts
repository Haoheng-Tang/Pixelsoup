import type { Editor, ImageDocument, NewDocumentOptions, PixelBuffer, PngCodec } from '../../core';
import {
  AddLayerCommand,
  CpuCompositor,
  DEFAULT_NEW_DOCUMENT,
  createBlankDocument,
  createDemoDocument,
  createDocument,
  createLayerId,
  createRasterLayer,
  deserializeDocument,
  flattenOnto,
  indexAbove,
  serializeDocument,
} from '../../core';
import type { FileRef, FileStore } from '../io/file-store';
import type { ExportOptions } from './file-types';
import {
  EXPORT_FORMATS,
  IMAGE_FILE_TYPE,
  OPEN_FILE_TYPES,
  PIXELSOUP_EXTENSION,
  PIXELSOUP_FILE_TYPE,
  PIXELSOUP_MIME_TYPE,
  exportFileType,
} from './file-types';

export interface DocumentSessionDeps {
  readonly editor: Editor;
  readonly store: FileStore;
  /** Codec for layer images inside .pixelsoup files. */
  readonly png: PngCodec;
  /** Decodes an imported image file (PNG, JPEG, WebP). */
  readonly decodeImage: (file: Blob) => Promise<PixelBuffer>;
  /** Encodes the flattened composite for export. */
  readonly encodeImage: (pixels: PixelBuffer, options: ExportOptions) => Promise<Blob>;
}

/** A file operation failed; `title` and `message` are written for the user. */
export class FileOperationError extends Error {
  override name = 'FileOperationError';

  constructor(
    readonly title: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * The open document as a file: its name, where Save writes it, and the new / open /
 * save / import / export operations. Asks no questions itself (confirming discards is
 * `AppController`'s job) and reaches files only through the injected `FileStore`.
 */
export class DocumentSession {
  private documentName: string;
  /** Where Save writes without asking; null until the document is opened from or saved to a file. */
  private fileRef: FileRef | null = null;
  private untitledCount = 0;
  private readonly listeners = new Set<() => void>();
  private revisionCounter = 0;

  constructor(private readonly deps: DocumentSessionDeps) {
    this.documentName = this.nextUntitledName();
  }

  /** Display name without extension, e.g. "Untitled-1" or "holiday". */
  get name(): string {
    return this.documentName;
  }

  get isDirty(): boolean {
    return this.deps.editor.isDirty;
  }

  /** True if Save overwrites the document's file without asking where. */
  get savesInPlace(): boolean {
    return this.deps.store.savesInPlace && this.fileRef !== null;
  }

  /** Changes on every session or editor change; usable as a React external-store snapshot. */
  get revision(): number {
    return this.revisionCounter + this.deps.editor.revision;
  }

  /** Notifies on name changes as well as every editor change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const unsubscribe = this.deps.editor.subscribe(listener);
    return () => {
      this.listeners.delete(listener);
      unsubscribe();
    };
  }

  newDocument(options: NewDocumentOptions): void {
    this.replace(createBlankDocument(options), this.nextUntitledName(), null);
  }

  /** Replaces the document with a new default blank one. */
  close(): void {
    this.newDocument(DEFAULT_NEW_DOCUMENT);
  }

  openDemo(): void {
    this.replace(createDemoDocument(), 'Demo', null);
  }

  /**
   * Asks for a .pixelsoup document or an image and opens it in place of the current
   * document. An image becomes a new single-layer document. Resolves to false if the
   * user cancelled.
   */
  async open(): Promise<boolean> {
    const opened = await this.deps.store.open(OPEN_FILE_TYPES);
    if (!opened) return false;
    const { file, ref } = opened;
    const name = baseName(file.name);
    let doc: ImageDocument;
    let saveTarget: FileRef | null = null;
    try {
      if (await isPixelsoupFile(file)) {
        doc = await deserializeDocument(new Uint8Array(await file.arrayBuffer()), this.deps.png);
        saveTarget = ref;
      } else {
        // Save must never overwrite the image with a .pixelsoup file, so keep no target.
        const pixels = await this.deps.decodeImage(file);
        doc = createDocument(pixels.width, pixels.height);
        doc.layers.push(createRasterLayer({ id: createLayerId(doc), name, pixels }));
      }
    } catch (error) {
      throw new FileOperationError(`Couldn't open “${file.name}”`, messageOf(error), {
        cause: error,
      });
    }
    this.replace(doc, name, saveTarget);
    return true;
  }

  /**
   * Asks for an image and adds it as a new layer, centred on the canvas and directly above
   * the active layer, as one undoable step. The new layer becomes active. Resolves to false
   * if the user cancelled.
   */
  async importAsLayer(): Promise<boolean> {
    const opened = await this.deps.store.open([IMAGE_FILE_TYPE]);
    if (!opened) return false;
    const { file } = opened;
    let pixels: PixelBuffer;
    try {
      pixels = await this.deps.decodeImage(file);
    } catch (error) {
      throw new FileOperationError(`Couldn't import “${file.name}”`, messageOf(error), {
        cause: error,
      });
    }
    const { editor } = this.deps;
    const doc = editor.document;
    const layer = createRasterLayer({
      id: createLayerId(doc),
      name: baseName(file.name),
      pixels,
      x: Math.floor((doc.width - pixels.width) / 2),
      y: Math.floor((doc.height - pixels.height) / 2),
    });
    const above = indexAbove(doc, editor.activeLayerId);
    editor.history.execute(new AddLayerCommand(layer, 'Import Image', above));
    editor.setActiveLayer(layer.id);
    return true;
  }

  /**
   * Saves to the document's file, or asks where if it has none (or the store can't
   * overwrite). A floating selection is committed first.
   */
  save(): Promise<boolean> {
    return this.write(this.savesInPlace ? this.fileRef : null);
  }

  /** Asks where to save, and makes that the document's file. */
  saveAs(): Promise<boolean> {
    return this.write(null);
  }

  /**
   * Asks where to save, then writes the flattened composite as an image. A floating
   * selection is committed first.
   */
  async exportImage(options: ExportOptions): Promise<boolean> {
    const { editor } = this.deps;
    const format = EXPORT_FORMATS[options.format];
    const doc = editor.document;
    const suggestedName = this.documentName + format.extension;
    try {
      const ref = await this.deps.store.save({
        suggestedName,
        type: exportFileType(options.format),
        data: () => {
          if (editor.document === doc) editor.commitFloating();
          const compositor = new CpuCompositor(doc.width, doc.height);
          compositor.composite(doc);
          const pixels = compositor.output;
          if (!format.alpha) flattenOnto(pixels, [255, 255, 255]);
          return this.deps.encodeImage(pixels, options);
        },
      });
      return ref !== null;
    } catch (error) {
      throw new FileOperationError(`Couldn't export “${suggestedName}”`, messageOf(error), {
        cause: error,
      });
    }
  }

  private async write(target: FileRef | null): Promise<boolean> {
    const { editor, store, png } = this.deps;
    const doc = editor.document;
    const suggestedName = this.documentName + PIXELSOUP_EXTENSION;
    let savedState = editor.history.stateId;
    let ref: FileRef | null;
    try {
      ref = await store.save({
        target,
        suggestedName,
        type: PIXELSOUP_FILE_TYPE,
        data: async () => {
          // A floating selection isn't saved: it's committed, as one more undo step.
          if (editor.document === doc) editor.commitFloating();
          // Edits made after this point aren't in the file, so they stay unsaved.
          savedState = editor.history.stateId;
          const bytes = await serializeDocument(doc, png);
          return new Blob([bytes], { type: PIXELSOUP_MIME_TYPE });
        },
      });
    } catch (error) {
      throw new FileOperationError(
        `Couldn't save “${target?.name ?? suggestedName}”`,
        messageOf(error),
        { cause: error },
      );
    }
    if (!ref) return false;
    if (editor.document === doc) {
      this.fileRef = ref;
      this.documentName = baseName(ref.name);
      editor.markSaved(savedState);
      this.emit();
    }
    return true;
  }

  private replace(doc: ImageDocument, name: string, ref: FileRef | null): void {
    this.documentName = name;
    this.fileRef = ref;
    this.deps.editor.replaceDocument(doc);
    this.emit();
  }

  private nextUntitledName(): string {
    return `Untitled-${++this.untitledCount}`;
  }

  private emit(): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener();
  }
}

/** "photo.final.png" → "photo.final"; names without an extension are kept whole. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** By extension, or by the zip signature for files saved without one. */
async function isPixelsoupFile(file: Blob & { readonly name: string }): Promise<boolean> {
  if (file.name.toLowerCase().endsWith(PIXELSOUP_EXTENSION)) return true;
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
