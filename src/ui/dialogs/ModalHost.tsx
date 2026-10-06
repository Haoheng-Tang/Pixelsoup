import { assertNever } from '../../core';
import type { AppController } from '../session/app-controller';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { ErrorDialog } from './ErrorDialog';
import { ExportDialog } from './ExportDialog';
import { NewDocumentDialog } from './NewDocumentDialog';

/** Renders whichever dialog the controller has open. */
export function ModalHost({ controller }: { controller: AppController }) {
  const modal = controller.modal;
  if (!modal) return null;
  switch (modal.kind) {
    case 'new-document':
      return (
        <NewDocumentDialog
          initial={controller.newDocumentOptions}
          onCreate={(options) => controller.createDocument(options)}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'export':
      return (
        <ExportDialog
          initial={controller.exportOptions}
          onExport={(options) => controller.exportImage(options)}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'confirm-discard':
      return (
        <ConfirmDiscardDialog
          documentName={modal.documentName}
          onAnswer={(discard) => controller.answerDiscard(discard)}
        />
      );
    case 'error':
      return (
        <ErrorDialog
          title={modal.title}
          message={modal.message}
          onClose={() => controller.dismiss()}
        />
      );
    default:
      return assertNever(modal);
  }
}
