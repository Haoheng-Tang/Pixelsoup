import type { NewDocumentOptions } from '../../core';
import { DEFAULT_NEW_DOCUMENT, assertNever } from '../../core';
import type { DocumentSession } from './document-session';
import { FileOperationError } from './document-session';
import type { ExportOptions } from './file-types';
import { DEFAULT_EXPORT_OPTIONS } from './file-types';

export type FileCommand =
  'new' | 'open' | 'import' | 'save' | 'save-as' | 'export' | 'close' | 'demo';

/** The modal dialog currently shown, if any. */
export type Modal =
  | { readonly kind: 'new-document' }
  | { readonly kind: 'export' }
  | { readonly kind: 'confirm-discard'; readonly documentName: string }
  | { readonly kind: 'error'; readonly title: string; readonly message: string };

/**
 * Runs File commands from the menu and shortcuts: asks before discarding unsaved work,
 * shows the New/Export dialogs, reports errors, and ignores new commands while a dialog
 * is open or an operation is still running. Plain TypeScript; React renders `modal`.
 */
export class AppController {
  private currentModal: Modal | null = null;
  private resolveConfirm: ((discard: boolean) => void) | null = null;
  private isBusy = false;
  private readonly listeners = new Set<() => void>();
  private revisionCounter = 0;
  private lastNewDocument: NewDocumentOptions = DEFAULT_NEW_DOCUMENT;
  private lastExport: ExportOptions = DEFAULT_EXPORT_OPTIONS;

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

  /** Closes the current dialog without acting (Cancel, Escape). */
  dismiss(): void {
    if (this.currentModal?.kind === 'confirm-discard') this.answerDiscard(false);
    else this.show(null);
  }

  /** Resolves to true if there is nothing to lose or the user agrees to discard it. */
  private confirmDiscard(): Promise<boolean> {
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

  private showError(error: unknown): void {
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
