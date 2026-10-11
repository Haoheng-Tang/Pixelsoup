import type { Editor, ImageDocument, LayerId } from '../../core';
import { liftSelectionCommand, rotateLayerCommand } from '../../core';
import type { FrameClock } from '../tools/frame-clock';

/**
 * Rotate Layer's live preview, through history. Each preview undoes the one before and
 * turns the layer afresh from its original pixels, so the canvas shows exactly what OK
 * keeps and resampling never compounds; at most one runs per animation frame.
 *
 * A floating selection turns with its outline. With a plain selection, the first preview
 * lifts the selected pixels into a floating selection, as the Move tool would, and turns
 * that. `finish` keeps the result (nothing at all if the angle is a whole number of
 * turns); `cancel` undoes everything, leaving it on the redo stack as cancelling a Move
 * drag does. If something else changes the document meanwhile, the preview leaves it be.
 */
export class LayerRotation {
  private readonly document: ImageDocument;
  private degrees = 0;
  private frame: number | null = null;
  /** `history.stateId` after the lift this preview made, if it made one. */
  private lifted: number | null = null;
  /** `history.stateId` after the rotation it shows, if it shows one. */
  private rotated: number | null = null;
  private done = false;

  constructor(
    private readonly editor: Editor,
    private readonly clock: FrameClock,
  ) {
    this.document = editor.document;
  }

  /** Shows the layer turned `degrees` clockwise (negative: anticlockwise) from the next frame. */
  preview(degrees: number): void {
    if (this.done) return;
    this.degrees = degrees;
    this.frame ??= this.clock.requestFrame(this.onFrame);
  }

  /** Shows the latest angle straight away, and keeps it. */
  finish(): void {
    if (this.done) return;
    this.cancelFrame();
    this.update();
    if (this.rotated === null) this.undo(this.lifted);
    this.done = true;
  }

  /** Puts back everything the preview did. */
  cancel(): void {
    if (this.done) return;
    this.cancelFrame();
    if (this.undo(this.rotated)) this.undo(this.lifted);
    this.done = true;
  }

  private readonly onFrame = (): void => {
    this.frame = null;
    if (!this.done) this.update();
  };

  private update(): void {
    if (!this.undo(this.rotated)) return;
    this.rotated = null;
    if (!Number.isFinite(this.degrees) || this.degrees % 360 === 0) return;
    const { editor } = this;
    const layerId = this.layerToTurn();
    const command =
      layerId && rotateLayerCommand(editor.document, layerId, this.degrees, editor.floating);
    if (!command) return;
    editor.history.execute(command);
    this.rotated = editor.history.stateId;
  }

  /**
   * The floating selection's layer; else the active layer, with any selected pixels lifted
   * out of it into a floating selection first. Null if there's nothing to turn.
   */
  private layerToTurn(): LayerId | null {
    const { editor } = this;
    if (editor.floating) return editor.floating.layerId;
    const layer = editor.activeLayer;
    const doc = editor.document;
    if (!layer?.visible) return null;
    if (!doc.selection) return layer.id;
    const lift = liftSelectionCommand(doc, layer.id);
    if (!lift) return null;
    editor.history.execute(lift);
    this.lifted = editor.history.stateId;
    return lift.floatId;
  }

  /**
   * Undoes the step that left history at `state`, if there was one. Returns false, and
   * stops previewing, if something else has changed the document since.
   */
  private undo(state: number | null): boolean {
    if (state === null) return true;
    const { editor } = this;
    if (editor.document !== this.document || editor.history.stateId !== state) {
      this.done = true;
      return false;
    }
    editor.history.undo();
    return true;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.clock.cancelFrame(this.frame);
    this.frame = null;
  }
}
