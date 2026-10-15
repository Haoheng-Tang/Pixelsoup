import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_NEW_DOCUMENT, Editor, createBlankDocument } from '../core';
import { App } from './App';
import { PixelClipboard } from './clipboard/pixel-clipboard';
import { writeImageToSystemClipboard } from './clipboard/system-clipboard';
import { Colors } from './color/colors';
import { encodeImage } from './io/export-image';
import { createFileStore } from './io/file-store';
import { decodeImageFile } from './io/image-decode';
import { pngCodec } from './io/png-codec';
import { AppController } from './session/app-controller';
import { DocumentSession } from './session/document-session';
import { createToolManager } from './tools/create-tools';
import { FreeTransform } from './transform/free-transform';
import { transformOptionsPanel } from './transform/TransformOptionsPanel';
import { ViewOptions } from './viewport/view-options';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const editor = new Editor(createBlankDocument(DEFAULT_NEW_DOCUMENT));
const session = new DocumentSession({
  editor,
  store: createFileStore(),
  png: pngCodec,
  decodeImage: decodeImageFile,
  encodeImage,
});
const controller = new AppController(session);
const clipboard = new PixelClipboard({
  editor,
  decodeImage: decodeImageFile,
  writeSystem: writeImageToSystemClipboard,
  onError: (error) => controller.showError(error),
});
const colors = new Colors();
const tools = createToolManager(editor, colors);
const freeTransform = new FreeTransform(editor, tools, { panel: transformOptionsPanel });
const view = new ViewOptions();

createRoot(container).render(
  <StrictMode>
    <App
      editor={editor}
      controller={controller}
      clipboard={clipboard}
      tools={tools}
      freeTransform={freeTransform}
      colors={colors}
      view={view}
    />
  </StrictMode>,
);
