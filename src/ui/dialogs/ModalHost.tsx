import { assertNever } from '../../core';
import type { Colors } from '../color/colors';
import { fillColor } from '../edit-actions';
import type { AppController } from '../session/app-controller';
import { CanvasSizeDialog } from './CanvasSizeDialog';
import { ConfirmDeleteLayerDialog } from './ConfirmDeleteLayerDialog';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { DuplicateLayerDialog } from './DuplicateLayerDialog';
import { ErrorDialog } from './ErrorDialog';
import { ExportDialog } from './ExportDialog';
import { FillDialog } from './FillDialog';
import { ImageSizeDialog } from './ImageSizeDialog';
import { NewDocumentDialog } from './NewDocumentDialog';
import { RotateLayerDialog } from './RotateLayerDialog';

interface ModalHostProps {
  controller: AppController;
  /** The foreground and background colours, for the Fill dialog. */
  colors: Colors;
}

/** Renders whichever dialog the controller has open. */
export function ModalHost({ controller, colors }: ModalHostProps) {
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
    case 'fill':
      return (
        <FillDialog
          initial={controller.fillSettings}
          colors={colors}
          selection={doc.selection !== null}
          onFill={(settings) => controller.fill(settings, fillColor(settings, colors))}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'duplicate-layer':
      return (
        <DuplicateLayerDialog
          layerName={modal.layerName}
          onDuplicate={(name) => controller.duplicateLayer(name)}
          onCancel={() => controller.dismiss()}
        />
      );
    case 'delete-layer':
      return (
        <ConfirmDeleteLayerDialog
          layerName={modal.layerName}
          onAnswer={(remove) => (remove ? controller.deleteLayer() : controller.dismiss())}
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
