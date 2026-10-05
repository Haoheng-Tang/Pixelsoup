import { Dialog } from './Dialog';

interface ConfirmDiscardDialogProps {
  documentName: string;
  onAnswer: (discard: boolean) => void;
}

/** Asks before unsaved changes are thrown away. Cancel has focus, so Enter is safe. */
export function ConfirmDiscardDialog({ documentName, onAnswer }: ConfirmDiscardDialogProps) {
  return (
    <Dialog title="Discard unsaved changes?" role="alertdialog" onCancel={() => onAnswer(false)}>
      <p className="dialog-text">
        “{documentName}” has changes that haven’t been saved. If you continue, they will be lost.
      </p>
      <div className="dialog-actions">
        <button type="button" data-autofocus onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button type="button" className="danger" onClick={() => onAnswer(true)}>
          Discard Changes
        </button>
      </div>
    </Dialog>
  );
}
