import type { Editor, LayerId, PixelBuffer, Rect } from '../../core';
import {
  assertNever,
  clearCommand,
  containsRect,
  copySelection,
  intersectRects,
  pasteCommand,
  selectionReachesLayer,
} from '../../core';
import { FileOperationError } from '../session/document-session';

/** The Edit menu's clipboard commands. */
export type ClipboardCommand = 'cut' | 'copy' | 'copy-merged' | 'paste';

/** What Cut, Copy or Copy Merged put on Pixelsoup's own clipboard. */
export interface ClipboardContent {
  /** The selected pixels, weighted by coverage, covering the selection's bounds. */
  readonly pixels: PixelBuffer;
  /** Where the pixels came from: the canvas position of their top-left pixel. */
  readonly x: number;
  readonly y: number;
  /** The size of the canvas they came from; 0 for an image pasted from another app. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** The part of a paste event's `clipboardData` that pasting reads. */
export interface PastedData {
  readonly items: ArrayLike<{
    readonly kind: string;
    readonly type: string;
    getAsFile(): File | null;
  }>;
}

export interface PixelClipboardDeps {
  readonly editor: Editor;
  /** Decodes an image pasted from another app. */
  readonly decodeImage: (file: Blob) => Promise<PixelBuffer>;
  /**
   * Puts a copy on the system clipboard as well, if the browser lets it, and resolves to
   * whether it did. Never rejects.
   */
  readonly writeSystem: (pixels: PixelBuffer) => Promise<boolean>;
  /** Reports an image that couldn't be pasted. */
  readonly onError: (error: unknown) => void;
}

/**
 * Pixelsoup's clipboard, session state like the colours: Cut, Copy and Copy Merged put the
 * selected pixels here (and on the system clipboard, where the browser allows), and Paste
 * adds them as a new layer. A paste event (Ctrl/Cmd+V) may bring an image copied in
 * another app instead; see `pasteData`. Plain TypeScript; the Edit menu and the clipboard
 * shortcuts drive it.
 */
export class PixelClipboard {
  private current: ClipboardContent | null = null;
  /**
   * True from a copy until the window loses focus: no other app can have changed the
   * system clipboard meanwhile, so what's here is the newest copy, whether or not the
   * browser let us write it there too.
   */
  private newest = false;
  private readonly listeners = new Set<() => void>();
  private revisionCounter = 0;

  constructor(private readonly deps: PixelClipboardDeps) {}

  get content(): ClipboardContent | null {
    return this.current;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Whether `command` would do anything now, for enabling menu items. Cut and Copy need a
   * selection that reaches the visible active layer, Copy Merged any selection, and Paste
   * something on this clipboard.
   */
  canRun(command: ClipboardCommand): boolean {
    switch (command) {
      case 'cut':
      case 'copy':
        return this.sourceLayer() !== null;
      case 'copy-merged':
        return this.deps.editor.document.selection !== null;
      case 'paste':
        return this.current !== null;
      default:
        return assertNever(command);
    }
  }

  /**
   * Runs a command from the Edit menu or a shortcut, if it can run. The copies commit a
   * floating selection first; Cut is Copy followed by Clear, one undo step ("Cut"). Paste
   * uses this clipboard only. `view` is the canvas area in view, in document coordinates:
   * a paste that can't go back where it came from is centred in it.
   */
  run(command: ClipboardCommand, view: Rect | null): void {
    if (!this.canRun(command)) return;
    if (command === 'paste') {
      if (this.current) this.paste(this.current, view);
      return;
    }
    const { editor } = this.deps;
    editor.commitFloating();
    const doc = editor.document;
    const layerId = command === 'copy-merged' ? null : this.sourceLayer();
    if (command !== 'copy-merged' && layerId === null) return;
    const copied = copySelection(doc, layerId === null ? 'composite' : { layerId });
    if (!copied) return;
    if (command === 'cut' && layerId !== null) {
      const clear = clearCommand(doc, layerId, null, 'Cut');
      if (clear) editor.history.execute(clear);
    }
    this.current = { ...copied, canvasWidth: doc.width, canvasHeight: doc.height };
    this.newest = true;
    void this.deps.writeSystem(copied.pixels);
    this.emit();
  }

  /**
   * Pastes what a paste event carries. An image copied in another app becomes the new
   * layer, centred in `view`. Pixelsoup's own clipboard is pasted instead when it holds
   * the newest copy, when the image is the one it put on the system clipboard (browsers
   * re-encode that, so it's matched loosely, and the exact pixels go back where they came
   * from), or when the event has no image.
   */
  async pasteData(data: PastedData | null, view: Rect | null): Promise<void> {
    const own = this.current;
    const file = imageFileOf(data);
    if (!file || (own && this.newest)) {
      if (own) this.paste(own, view);
      return;
    }
    let pixels: PixelBuffer;
    try {
      pixels = await this.deps.decodeImage(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.onError(
        new FileOperationError("Couldn't paste the image", message, { cause: error }),
      );
      return;
    }
    if (own && sameImage(pixels, own.pixels)) this.paste(own, view);
    else this.paste({ pixels, x: 0, y: 0, canvasWidth: 0, canvasHeight: 0 }, view);
  }

  /** Call when the window loses focus: another app may then change the system clipboard. */
  windowBlurred(): void {
    this.newest = false;
  }

  /**
   * Adds `content` as a new layer "Layer N" above the active layer, after committing a
   * floating selection, and makes it active: one undo step ("Paste"), which deselects.
   */
  private paste(content: ClipboardContent, view: Rect | null): void {
    const { editor } = this.deps;
    editor.commitFloating();
    const doc = editor.document;
    const { x, y } = pastePosition(doc, content, view);
    const command = pasteCommand(doc, editor.activeLayerId, content.pixels, x, y);
    editor.history.execute(command);
    editor.setActiveLayer(command.layer.id);
  }

  /** The active layer, if it's visible and the selection reaches it: what Cut and Copy take. */
  private sourceLayer(): LayerId | null {
    const { editor } = this.deps;
    const id = editor.activeLayerId;
    return id !== null && selectionReachesLayer(editor.document, id) ? id : null;
  }

  private emit(): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Where pasted pixels go: back where they came from when that was a canvas of this size
 * and they fit on it; otherwise centred in the part of the canvas in `view` (or the whole
 * canvas, if none of it is in view) and kept on the canvas. Pixels larger than the canvas
 * are centred on it.
 */
export function pastePosition(
  canvas: { readonly width: number; readonly height: number },
  content: ClipboardContent,
  view: Rect | null,
): { x: number; y: number } {
  const { width, height } = content.pixels;
  const bounds = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const sameCanvas = content.canvasWidth === canvas.width && content.canvasHeight === canvas.height;
  if (sameCanvas && containsRect(bounds, { x: content.x, y: content.y, width, height })) {
    return { x: content.x, y: content.y };
  }
  const area = (view && intersectRects(view, bounds)) ?? bounds;
  return {
    x: centreIn(area.x, area.width, width, canvas.width),
    y: centreIn(area.y, area.height, height, canvas.height),
  };
}

/** Centres `size` in [start, start + extent) along one axis, kept within [0, limit). */
function centreIn(start: number, extent: number, size: number, limit: number): number {
  if (size >= limit) return Math.floor((limit - size) / 2);
  const at = Math.floor(start + (extent - size) / 2);
  return Math.min(Math.max(at, 0), limit - size);
}

/** The pasted image file, a PNG if there is one, else any image; null if none. */
export function imageFileOf(data: PastedData | null): File | null {
  if (!data) return null;
  let image: File | null = null;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    if (image && item.type !== 'image/png') continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (item.type === 'image/png') return file;
    image = file;
  }
  return image;
}

/**
 * Whether `pasted` is `ours` after a trip through the system clipboard. Browsers decode
 * and re-encode what's written there, through premultiplied alpha, so a translucent
 * pixel's colour may come back off by up to about 255 / (2 × alpha); its alpha survives.
 */
export function sameImage(pasted: PixelBuffer, ours: PixelBuffer): boolean {
  if (pasted.width !== ours.width || pasted.height !== ours.height) return false;
  const a = pasted.data;
  const b = ours.data;
  for (let i = 0; i < b.length; i += 4) {
    const alpha = b[i + 3];
    if (Math.abs(a[i + 3] - alpha) > 1) return false;
    if (alpha === 0) continue;
    const tolerance = 1 + Math.ceil(255 / alpha);
    if (
      Math.abs(a[i] - b[i]) > tolerance ||
      Math.abs(a[i + 1] - b[i + 1]) > tolerance ||
      Math.abs(a[i + 2] - b[i + 2]) > tolerance
    ) {
      return false;
    }
  }
  return true;
}
