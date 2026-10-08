import { commitFloatingCommand } from './commands/float-commands';
import type { ImageDocument } from './document';
import { documentBounds, findLayer, findLayerIndex, getLayerIndex } from './document';
import type { FloatingSelection } from './floating-selection';
import { isFloatingIn } from './floating-selection';
import type { DocumentChange } from './history/command';
import type { History } from './history/history';
import { LinearHistory } from './history/history';
import type { Layer, LayerId } from './layer';

/** What `Editor` broadcasts: a command's change, a save-state change, or a document swap. */
export interface EditorChange extends DocumentChange {
  /**
   * True when `replaceDocument` swapped in another document, whose size may differ:
   * views should rebuild instead of updating `dirty` incrementally.
   */
  readonly documentReplaced?: boolean;
  /** True when `activeLayerId` changed, whether set or moved off a layer that went away. */
  readonly activeLayerChanged?: boolean;
  /** True when `floating` changed: a selection was lifted or committed, or that was undone. */
  readonly floatingChanged?: boolean;
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
  private activeId: LayerId | null = null;
  /** Stack index of the active layer when last seen, to pick a neighbour if it goes away. */
  private activeIndex = -1;
  private floatingState: FloatingSelection | null = null;

  constructor(document: ImageDocument) {
    this.currentDocument = document;
    this.currentHistory = this.createHistory(document);
    this.savedStateId = this.currentHistory.stateId;
    this.activateTopLayer();
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
   * The layer that layer commands and tools act on. Session state: not part of the
   * document, not saved and never an undo step. While the document has layers it is
   * always one of them; null only when it has none.
   */
  get activeLayerId(): LayerId | null {
    return this.activeId;
  }

  get activeLayer(): Layer | null {
    return this.activeId === null ? null : (findLayer(this.currentDocument, this.activeId) ?? null);
  }

  /**
   * Makes another layer of the document active. Throws if the document has no such layer.
   * Commits a floating selection first, whose layer stays active while it floats.
   */
  setActiveLayer(id: LayerId): void {
    getLayerIndex(this.currentDocument, id);
    if (this.floatingState && id !== this.floatingState.layerId) this.commitFloating();
    this.activeIndex = getLayerIndex(this.currentDocument, id);
    if (id === this.activeId) return;
    this.activeId = id;
    this.emit({ dirty: null, activeLayerChanged: true });
  }

  /**
   * The selection the Move tool lifted into a layer of its own, until it's committed
   * back into its source layer. Session state like the active layer: not saved, and
   * restored by undo and redo of the lift and commit. While it exists, its layer is the
   * active layer.
   */
  get floating(): FloatingSelection | null {
    return this.floatingState;
  }

  /**
   * Commits the floating selection into its source layer as one undo step. Returns false
   * if there was none.
   */
  commitFloating(): boolean {
    const floating = this.floatingState;
    const command = floating && commitFloatingCommand(this.currentDocument, floating);
    if (!command) return false;
    this.currentHistory.execute(command);
    return true;
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

  /**
   * Swaps in another document (new, open, close) with a fresh history. It starts clean,
   * with its top layer active and nothing floating.
   */
  replaceDocument(document: ImageDocument): void {
    const wasFloating = this.floatingState !== null;
    this.currentDocument = document;
    this.currentHistory = this.createHistory(document);
    this.savedStateId = this.currentHistory.stateId;
    this.floatingState = null;
    this.activateTopLayer();
    this.emit({
      dirty: documentBounds(document),
      documentReplaced: true,
      activeLayerChanged: true,
      ...(wasFloating && { floatingChanged: true }),
    });
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
      if (document !== this.currentDocument) return;
      let emitted: EditorChange = change;
      if (this.keepFloating(change)) emitted = { ...emitted, floatingChanged: true };
      if (this.keepActiveLayer()) emitted = { ...emitted, activeLayerChanged: true };
      this.emit(emitted);
    });
  }

  private activateTopLayer(): void {
    const { layers } = this.currentDocument;
    this.activeIndex = layers.length - 1;
    this.activeId = layers.at(-1)?.id ?? null;
  }

  /**
   * Takes the floating selection a change reports, if any, and drops it should its layer
   * no longer be directly above its source. Returns true if it changed.
   */
  private keepFloating(change: DocumentChange): boolean {
    const previous = this.floatingState;
    let floating = change.floating === undefined ? previous : change.floating;
    if (floating && !isFloatingIn(this.currentDocument, floating)) floating = null;
    this.floatingState = floating;
    return floating !== previous;
  }

  /**
   * After a change to the document, makes a floating selection's layer active, or moves
   * the active layer off a layer that went away: to the one below where it was, else the
   * one above (the bottom one now), else the top. Returns true if the active layer changed.
   */
  private keepActiveLayer(): boolean {
    const doc = this.currentDocument;
    const previous = this.activeId;
    if (this.floatingState) {
      this.activeId = this.floatingState.layerId;
      this.activeIndex = findLayerIndex(doc, this.activeId);
      return this.activeId !== previous;
    }
    const index = this.activeId === null ? -1 : findLayerIndex(doc, this.activeId);
    if (index >= 0) {
      this.activeIndex = index;
      return false;
    }
    if (this.activeIndex < 0 || doc.layers.length === 0) {
      this.activateTopLayer();
    } else {
      this.activeIndex = Math.min(Math.max(this.activeIndex - 1, 0), doc.layers.length - 1);
      this.activeId = doc.layers[this.activeIndex].id;
    }
    return this.activeId !== previous;
  }

  private emit(change: EditorChange): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener(change);
  }
}
