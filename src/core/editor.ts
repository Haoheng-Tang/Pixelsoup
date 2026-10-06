import type { ImageDocument } from './document';
import { documentBounds } from './document';
import type { DocumentChange } from './history/command';
import type { History } from './history/history';
import { LinearHistory } from './history/history';

/** What `Editor` broadcasts: a command's change, a save-state change, or a document swap. */
export interface EditorChange extends DocumentChange {
  /**
   * True when `replaceDocument` swapped in another document, whose size may differ:
   * views should rebuild instead of updating `dirty` incrementally.
   */
  readonly documentReplaced?: boolean;
}

export type EditorListener = (change: EditorChange) => void;

/**
 * Owns the open document and its history, and broadcasts every change to subscribers
 * (viewport, panels). UI code reads `document` freely but mutates it only through
 * `history.execute(command)`. New/Open swap the document with `replaceDocument`.
 */
export class Editor {
  private currentDocument: ImageDocument;
  private currentHistory: History;
  private savedStateId: number;
  private readonly listeners = new Set<EditorListener>();
  private revisionCounter = 0;

  constructor(document: ImageDocument) {
    this.currentDocument = document;
    this.currentHistory = this.createHistory(document);
    this.savedStateId = this.currentHistory.stateId;
  }

  get document(): ImageDocument {
    return this.currentDocument;
  }

  /** History of the current document. Read it at use time: `replaceDocument` swaps it. */
  get history(): History {
    return this.currentHistory;
  }

  /** Increments on every change; handy as a React external-store snapshot. */
  get revision(): number {
    return this.revisionCounter;
  }

  /** True if the document differs from when it was created, loaded or last marked saved. */
  get isDirty(): boolean {
    return this.currentHistory.stateId !== this.savedStateId;
  }

  /**
   * Records that the document as it was at history state `stateId` (default: now) has
   * been saved. Pass the `history.stateId` read when serialization started, so edits
   * made while the file was being written still count as unsaved.
   */
  markSaved(stateId = this.currentHistory.stateId): void {
    this.savedStateId = stateId;
    this.emit({ dirty: null });
  }

  /** Swaps in another document (new, open, close) with a fresh history. It starts clean. */
  replaceDocument(document: ImageDocument): void {
    this.currentDocument = document;
    this.currentHistory = this.createHistory(document);
    this.savedStateId = this.currentHistory.stateId;
    this.emit({ dirty: documentBounds(document), documentReplaced: true });
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private createHistory(document: ImageDocument): History {
    return new LinearHistory(document, (change) => {
      // Ignore a stale history whose document has since been replaced.
      if (document === this.currentDocument) this.emit(change);
    });
  }

  private emit(change: EditorChange): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener(change);
  }
}
