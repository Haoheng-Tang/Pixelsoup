import { Dialog } from './Dialog';

interface ErrorDialogProps {
  title: string;
  message: string;
  onClose: () => void;
}

export function ErrorDialog({ title, message, onClose }: ErrorDialogProps) {
  return (
    <Dialog title={title} role="alertdialog" onCancel={onClose}>
      <p className="dialog-text">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="primary" data-autofocus onClick={onClose}>
          OK
        </button>
      </div>
    </Dialog>
  );
}
