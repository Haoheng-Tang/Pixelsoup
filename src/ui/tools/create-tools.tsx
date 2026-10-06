import type { Editor } from '../../core';
import { MarqueeTool } from './marquee-tool';
import { SelectionOptions } from './selection-options';
import { SelectionOptionsPanel } from './SelectionOptionsPanel';
import { ToolManager } from './tool-manager';

/** Creates the app's tools, in toolbar order; the first is active at startup. */
export function createToolManager(editor: Editor): ToolManager {
  const selectionOptions = new SelectionOptions();
  function SelectionToolOptions() {
    return <SelectionOptionsPanel options={selectionOptions} />;
  }
  return new ToolManager(
    [
      new MarqueeTool('rect', selectionOptions, SelectionToolOptions),
      new MarqueeTool('ellipse', selectionOptions, SelectionToolOptions),
    ],
    editor,
  );
}
