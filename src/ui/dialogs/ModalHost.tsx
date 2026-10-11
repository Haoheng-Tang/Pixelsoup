import { assertNever } from '../../core';
import type { AppController } from '../session/app-controller';
import { CanvasSizeDialog } from './CanvasSizeDialog';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { ErrorDialog } from './ErrorDialog';
import { ExportDialog } from './ExportDialog';
import { ImageSizeDialog } from './ImageSizeDialog';
import { NewDocumentDialog } from './NewDocumentDialog';
import { RotateLayerDialog } from './RotateLayerDialog';

/** Renders whichever dialog the controller has open. */
export function ModalHost({ controller }: { controller: AppController }) {
  const modal = controller.modal;
  if (!modal) return null;
  const doc = controller.session.editor.document;
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
    case 'image-size':
      return (
        <ImageSizeDialog
          width={doc.width}
          height={doc.height}
          initial={controller.imageSizeSettings}
          onResize={(options) => controller.resizeImage(options)}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'canvas-size':
      return (
        <CanvasSizeDialog
          width={doc.width}
          height={doc.height}
          initial={controller.canvasSizeSettings}
          onResize={(options) => controller.resizeCanvas(options)}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'rotate-layer':
      return (
        <RotateLayerDialog
          target={modal.target}
          onPreview={(degrees) => controller.previewRotation(degrees)}
          onRotate={(degrees) => controller.rotateLayer(degrees)}
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
