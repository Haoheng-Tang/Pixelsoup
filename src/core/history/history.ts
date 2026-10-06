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
  /**
   * Identifies the saved content of the document at the current history position. Every
   * execute (including a merge) of a command that changes content moves to a new,
   * never-reused ID; commands with `changesContent: false` keep the current ID. Undo and
   * redo return to the IDs recorded for the states they restore. Store it and compare
   * later to tell whether the document has changed since then (e.g. since the last save).
   */
  readonly stateId: number;
  /** Forgets all recorded steps without touching the document. */
  clear(): void;
}

interface Step {
  readonly command: Command;
  /** State IDs before and after the command; `after` moves when a later command merges in. */
  readonly before: number;
  after: number;
}

/**
 * Straightforward linear history: one undo stack, one redo stack, oldest steps dropped
 * past `limit`. Memory-aware storage (e.g. tiled pixel diffs) can replace this later
 * behind the same interface.
 */
export class LinearHistory implements History {
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  private currentStateId = 0;
  private lastStateId = 0;

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
      top.command.mergeKey === command.mergeKey &&
      top.command.mergeWith?.(command) === true;
    const after = command.changesContent === false ? this.currentStateId : ++this.lastStateId;
    if (merged) {
      top.after = after;
    } else {
      this.undoStack.push({ command, before: this.currentStateId, after });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.currentStateId = after;
    this.redoStack.length = 0;
    this.onChange(change);
  }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    const change = step.command.revert(this.doc);
    this.currentStateId = step.before;
    this.redoStack.push(step);
    this.onChange(change);
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    const change = step.command.apply(this.doc);
    this.currentStateId = step.after;
    this.undoStack.push(step);
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
    return this.undoStack.at(-1)?.command.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.command.label ?? null;
  }

  get stateId(): number {
    return this.currentStateId;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange({ dirty: null });
  }
}
