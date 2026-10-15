import type { Command, ImageDocument, NewDocumentOptions, Rgb } from '../../core';
import { DEFAULT_NEW_DOCUMENT, assertNever, canvasSizeCommand, imageSizeCommand } from '../../core';
import type { FillSettings } from '../edit-actions';
import { DEFAULT_FILL_SETTINGS, canFill, runFill } from '../edit-actions';
import type { DroppedData } from '../io/file-store';
import { canRunLayerAction, runLayerAction } from '../layer-actions';
import type { DocumentSession } from './document-session';
import { FileOperationError } from './document-session';
import type { ExportOptions } from './file-types';
import { DEFAULT_EXPORT_OPTIONS } from './file-types';
import type {
  CanvasSizeOptions,
  CanvasSizeSettings,
  ImageSizeOptions,
  ImageSizeSettings,
} from './image-options';
import { DEFAULT_CANVAS_SIZE_SETTINGS, DEFAULT_IMAGE_SIZE_SETTINGS } from './image-options';

export type FileCommand =
  'new' | 'open' | 'import' | 'save' | 'save-as' | 'export' | 'close' | 'demo';

/** Image menu items that open a dialog. */
export type ImageDialog = 'image-size' | 'canvas-size';

/** The modal dialog currently shown, if any. */
export type Modal =
  | { readonly kind: 'new-document' }
  | { readonly kind: 'export' }
  | { readonly kind: 'image-size' }
  | { readonly kind: 'canvas-size' }
  | { readonly kind: 'fill' }
  | { readonly kind: 'duplicate-layer'; readonly layerName: string }
  | { readonly kind: 'delete-layer'; readonly layerName: string }
  | { readonly kind: 'confirm-discard'; readonly documentName: string }
  | { readonly kind: 'error'; readonly title: string; readonly message: string };

/**
 * Runs File commands from the menu and shortcuts, files dropped on the page, the Image and
 * Edit menus' dialogs and the canvas menu's Duplicate Layer and Delete Layer dialogs:
 * asks before discarding unsaved work, shows the dialogs and carries out what they ask,
 * reports errors, and ignores new commands while a dialog is open or an operation is
 * still running. Plain TypeScript; React renders `modal`.
 */
export class AppController {
  private currentModal: Modal | null = null;
  private resolveConfirm: ((discard: boolean) => void) | null = null;
  private isBusy = false;
  private readonly listeners = new Set<() => void>();
  private revisionCounter = 0;
  private lastNewDocument: NewDocumentOptions = DEFAULT_NEW_DOCUMENT;
  private lastExport: ExportOptions = DEFAULT_EXPORT_OPTIONS;
  private lastImageSize: ImageSizeSettings = DEFAULT_IMAGE_SIZE_SETTINGS;
  private lastCanvasSize: CanvasSizeSettings = DEFAULT_CANVAS_SIZE_SETTINGS;
  private lastFill: FillSettings = DEFAULT_FILL_SETTINGS;

  constructor(readonly session: DocumentSession) {}

  get modal(): Modal | null {
    return this.currentModal;
  }

  /** True while a file operation (picker, read, write) is in progress. */
  get busy(): boolean {
    return this.isBusy;
  }

  /** True while commands are ignored: a dialog is open or an operation is running. */
  get blocked(): boolean {
    return this.currentModal !== null || this.isBusy;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  /** Initial settings for the New dialog: the last ones used to create a document. */
  get newDocumentOptions(): NewDocumentOptions {
    return this.lastNewDocument;
  }

  /** Initial settings for the Export dialog: the last ones exported with. */
  get exportOptions(): ExportOptions {
    return this.lastExport;
  }

  /** Initial settings for the Image Size dialog: the last ones resized with. */
  get imageSizeSettings(): ImageSizeSettings {
    return this.lastImageSize;
  }

  /** Initial settings for the Canvas Size dialog: the last ones resized with. */
  get canvasSizeSettings(): CanvasSizeSettings {
    return this.lastCanvasSize;
  }

  /** Initial settings for the Fill dialog: the last ones filled with. */
  get fillSettings(): FillSettings {
    return this.lastFill;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Runs a command, unless blocked. Must be called from the triggering click or key
   * press: file pickers only open during user activation.
   */
  run(command: FileCommand): void {
    if (this.blocked) return;
    const { session } = this;
    switch (command) {
      case 'new':
        this.task(async () => {
          if (await this.confirmDiscard()) this.show({ kind: 'new-document' });
        });
        break;
      case 'open':
        this.task(async () => {
          if (await this.confirmDiscard()) await session.open();
        });
        break;
      case 'import':
        this.task(() => session.importAsLayer());
        break;
      case 'save':
        this.task(() => session.save());
        break;
      case 'save-as':
        this.task(() => session.saveAs());
        break;
      case 'export':
        this.show({ kind: 'export' });
        break;
      case 'close':
        this.task(async () => {
          if (await this.confirmDiscard()) session.close();
        });
        break;
      case 'demo':
        this.task(async () => {
          if (await this.confirmDiscard()) session.openDemo();
        });
        break;
      default:
        assertNever(command);
    }
  }

  /**
   * Opens the file dropped on the page (`data`, from the drop event), as File → Open would:
   * after asking before discarding unsaved changes, and not while blocked. Returns false if
   * there was nothing to open, or it was blocked.
   */
  openDropped(data: DroppedData): boolean {
    if (this.blocked) return false;
    const dropped = this.session.dropped(data);
    if (!dropped) return false;
    this.task(async () => {
      const opened = await dropped;
      if (await this.confirmDiscard()) await this.session.openFile(opened);
    });
    return true;
  }

  /** Confirms the New dialog. */
  createDocument(options: NewDocumentOptions): void {
    if (this.currentModal?.kind !== 'new-document') return;
    this.show(null);
    try {
      this.session.newDocument(options);
      this.lastNewDocument = options;
    } catch (error) {
      this.showError(error);
    }
  }

  /** Confirms the Export dialog. Call from its button's click so the save picker can open. */
  exportImage(options: ExportOptions): void {
    if (this.currentModal?.kind !== 'export' || this.isBusy) return;
    this.lastExport = options;
    this.show(null);
    this.task(() => this.session.exportImage(options));
  }

  /** Answers the discard confirmation. */
  answerDiscard(discard: boolean): void {
    const resolve = this.resolveConfirm;
    if (!resolve) return;
    this.resolveConfirm = null;
    this.show(null);
    resolve(discard);
  }

  /** Opens one of the Image menu's dialogs, unless blocked. */
  openDialog(dialog: ImageDialog): void {
    if (this.blocked) return;
    this.show({ kind: dialog });
  }

  /** Confirms Image Size: resamples the document, committing a floating selection first. */
  resizeImage(options: ImageSizeOptions): void {
    if (this.currentModal?.kind !== 'image-size') return;
    const { width, height, interpolation, unit, keepAspect } = options;
    this.lastImageSize = { unit, keepAspect, interpolation };
    this.show(null);
    this.edit((doc) => imageSizeCommand(doc, width, height, interpolation));
  }

  /** Confirms Canvas Size, committing a floating selection first. */
  resizeCanvas(options: CanvasSizeOptions): void {
    if (this.currentModal?.kind !== 'canvas-size') return;
    const { width, height, horizontal, vertical, relative } = options;
    this.lastCanvasSize = { relative };
    this.show(null);
    this.edit((doc) => canvasSizeCommand(doc, width, height, horizontal, vertical));
  }

  /** Opens the Fill dialog, unless blocked or the active layer is hidden. */
  openFill(): void {
    if (this.blocked || !canFill(this.session.editor)) return;
    this.show({ kind: 'fill' });
  }

  /**
   * Confirms the Fill dialog: fills the active layer with `color`, which `settings` chose
   * from the current colours (see `runFill`), and remembers `settings`.
   */
  fill(settings: FillSettings, color: Rgb): void {
    if (this.currentModal?.kind !== 'fill') return;
    this.lastFill = settings;
    this.show(null);
    const mode = settings.preserveTransparency ? 'preserve-transparency' : 'normal';
    try {
      runFill(this.session.editor, color, settings.opacity / 100, mode);
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * Opens the Duplicate Layer dialog (the canvas's context menu) for the active layer,
   * unless blocked or it can't be duplicated.
   */
  openDuplicateLayer(): void {
    const { editor } = this.session;
    const layer = editor.activeLayer;
    if (this.blocked || !layer || !canRunLayerAction(editor, 'duplicate')) return;
    this.show({ kind: 'duplicate-layer', layerName: layer.name });
  }

  /**
   * Confirms Duplicate Layer: copies the active layer directly above as `name` (trimmed)
   * and makes the copy active, one undo step. A blank name is refused and leaves the
   * dialog open.
   */
  duplicateLayer(name: string): void {
    if (this.currentModal?.kind !== 'duplicate-layer' || name.trim() === '') return;
    this.show(null);
    try {
      runLayerAction(this.session.editor, 'duplicate', { name });
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * Opens the confirmation for deleting the active layer (the canvas's context menu),
   * unless blocked or it can't be deleted (the only layer).
   */
  openDeleteLayer(): void {
    const { editor } = this.session;
    const layer = editor.activeLayer;
    if (this.blocked || !layer || !canRunLayerAction(editor, 'delete')) return;
    this.show({ kind: 'delete-layer', layerName: layer.name });
  }

  /** Confirms Delete Layer: deletes the active layer, one undo step. */
  deleteLayer(): void {
    if (this.currentModal?.kind !== 'delete-layer') return;
    this.show(null);
    try {
      runLayerAction(this.session.editor, 'delete');
    } catch (error) {
      this.showError(error);
    }
  }

  /** Closes the current dialog without acting (Cancel, Escape). */
  dismiss(): void {
    if (this.currentModal?.kind === 'confirm-discard') {
      this.answerDiscard(false);
      return;
    }
    this.show(null);
  }

  /**
   * Executes the command `build` makes for the document, if it makes one, after
   * committing a floating selection. `build` runs again after the commit, so the command
   * sees the document as it then is.
   */
  private edit(build: (doc: ImageDocument) => Command | null): void {
    const { editor } = this.session;
    try {
      if (!build(editor.document)) return;
      editor.commitFloating();
      const command = build(editor.document);
      if (command) editor.history.execute(command);
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * Resolves to true if there is nothing to lose or the user agrees to discard it. A
   * transform in progress is applied first, so that it counts as a change to lose.
   */
  private confirmDiscard(): Promise<boolean> {
    this.session.editor.applyPending();
    if (!this.session.isDirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.resolveConfirm = resolve;
      this.show({ kind: 'confirm-discard', documentName: this.session.name });
    });
  }

  /** Runs `operation` as the one busy operation. Its synchronous start runs immediately. */
  private task(operation: () => Promise<unknown>): void {
    this.setBusy(true);
    void operation()
      .catch((error: unknown) => this.showError(error))
      .finally(() => this.setBusy(false));
  }

  /** Shows `error` in a dialog: a `FileOperationError`'s own title and message, if it is one. */
  showError(error: unknown): void {
    console.error(error);
    if (error instanceof FileOperationError) {
      this.show({ kind: 'error', title: error.title, message: error.message });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      this.show({ kind: 'error', title: 'Something went wrong', message });
    }
  }

  private setBusy(busy: boolean): void {
    this.isBusy = busy;
    this.emit();
  }

  private show(modal: Modal | null): void {
    this.currentModal = modal;
    this.emit();
  }

  private emit(): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener();
  }
}
