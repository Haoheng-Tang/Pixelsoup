import type { ImageDocument } from './document';
import type { DocumentChange } from './history/command';
import type { ChangeListener, History } from './history/history';
import { LinearHistory } from './history/history';

/**
 * Owns one open document and its history, and broadcasts every change to subscribers
 * (viewport, panels). UI code reads `document` freely but mutates it only through
 * `history.execute(command)`.
 */
export class Editor {
  readonly history: History;
  private readonly listeners = new Set<ChangeListener>();
  private revisionCounter = 0;

  constructor(readonly document: ImageDocument) {
    this.history = new LinearHistory(document, (change) => this.emit(change));
  }

  /** Increments on every change; handy as a React external-store snapshot. */
  get revision(): number {
    return this.revisionCounter;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(change: DocumentChange): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener(change);
  }
}
