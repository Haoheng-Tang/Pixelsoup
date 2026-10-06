import type { ImageDocument } from '../document';
import { unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import { Selection } from '../selection';

/**
 * Replaces the document's selection (null deselects). An empty selection is stored as
 * null, so `doc.selection` is always either null or selects something.
 *
 * The selection isn't saved with the document, so this command doesn't make the document
 * unsaved (`changesContent` is false), but it is undoable like any other edit.
 */
export class SetSelectionCommand implements Command {
  readonly changesContent = false;
  private selection: Selection | null;
  private previous: Selection | null = null;
  private captured = false;

  /**
   * @param mergeKey pass the same key for every update in one gesture (e.g. a drag) so
   *   the whole gesture becomes a single undo step.
   */
  constructor(
    selection: Selection | null,
    readonly label = 'Change Selection',
    readonly mergeKey?: string,
  ) {
    this.selection = selection && !selection.isEmpty ? selection : null;
  }

  apply(doc: ImageDocument): DocumentChange {
    if (
      this.selection &&
      (this.selection.width !== doc.width || this.selection.height !== doc.height)
    ) {
      throw new RangeError(
        `Selection is ${this.selection.width}x${this.selection.height}, document is ${doc.width}x${doc.height}`,
      );
    }
    if (!this.captured) {
      this.previous = doc.selection;
      this.captured = true;
    }
    return replaceSelection(doc, this.selection);
  }

  revert(doc: ImageDocument): DocumentChange {
    return replaceSelection(doc, this.previous);
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetSelectionCommand)) return false;
    this.selection = next.selection;
    return true;
  }
}

function replaceSelection(doc: ImageDocument, selection: Selection | null): DocumentChange {
  const before = doc.selection?.bounds() ?? null;
  doc.selection = selection;
  return { dirty: null, selectionDirty: unionRects(before, selection?.bounds() ?? null) };
}

/** Selects the whole canvas, or returns null if it already is. */
export function selectAllCommand(doc: ImageDocument): SetSelectionCommand | null {
  const all = Selection.selectAll(doc.width, doc.height);
  if (doc.selection?.equals(all)) return null;
  return new SetSelectionCommand(all, 'Select All');
}

/** Clears the selection, or returns null if there is none. */
export function deselectCommand(doc: ImageDocument): SetSelectionCommand | null {
  return doc.selection ? new SetSelectionCommand(null, 'Deselect') : null;
}

/**
 * Inverts the selection, or returns null if there is none (as in other editors, Inverse
 * needs an existing selection). Inverting a select-all deselects.
 */
export function invertSelectionCommand(doc: ImageDocument): SetSelectionCommand | null {
  return doc.selection
    ? new SetSelectionCommand(doc.selection.invert(), 'Inverse Selection')
    : null;
}
