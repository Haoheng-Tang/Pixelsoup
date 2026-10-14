import { Dialog } from './Dialog';

interface ConfirmDeleteLayerDialogProps {
  layerName: string;
  onAnswer: (remove: boolean) => void;
}

/** Asks before deleting a layer from the canvas's context menu. Cancel has focus, so Enter is safe. */
export function ConfirmDeleteLayerDialog({ layerName, onAnswer }: ConfirmDeleteLayerDialogProps) {
  return (
    <Dialog
      title={`Delete the layer “${layerName}”?`}
      role="alertdialog"
      onCancel={() => onAnswer(false)}
    >
      <p className="dialog-text">You can bring it back with Undo.</p>
      <div className="dialog-actions">
        <button type="button" data-autofocus onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button type="button" className="danger" onClick={() => onAnswer(true)}>
          Delete
        </button>
      </div>
    </Dialog>
  );
}
