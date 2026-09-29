import type { ImageDocument } from '../document';
import type { Command, DocumentChange } from './command';

export type ChangeListener = (change: DocumentChange) => void;

/** Command-based undo/redo stack for a single document. */
export interface History {
  /** Applies `command` to the document and records it (possibly merged) for undo. */
  execute(command: Command): void;
  /** Returns false if there was nothing to undo. */
  undo(): boolean;
  /** Returns false if there was nothing to redo. */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  /** Forgets all recorded steps without touching the document. */
  clear(): void;
}

/**
 * Straightforward linear history: one undo stack, one redo stack, oldest steps dropped
 * past `limit`. Memory-aware storage (e.g. tiled pixel diffs) can replace this later
 * behind the same interface.
 */
export class LinearHistory implements History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(
    private readonly doc: ImageDocument,
    private readonly onChange: ChangeListener,
    private readonly limit = 200,
  ) {}

  execute(command: Command): void {
    const change = command.apply(this.doc);
    const top = this.undoStack.at(-1);
    const merged =
      this.redoStack.length === 0 &&
      top !== undefined &&
      command.mergeKey !== undefined &&
      top.mergeKey === command.mergeKey &&
      top.mergeWith?.(command) === true;
    if (!merged) {
      this.undoStack.push(command);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.onChange(change);
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    const change = command.revert(this.doc);
    this.redoStack.push(command);
    this.onChange(change);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    const change = command.apply(this.doc);
    this.undoStack.push(command);
    this.onChange(change);
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange({ dirty: null });
  }
}
