import type { Editor } from '../../core';
import { MarqueeTool } from './marquee-tool';
import { MoveOptionsPanel } from './MoveOptionsPanel';
import { MoveTool } from './move-tool';
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
      new MoveTool(MoveOptionsPanel),
    ],
    editor,
  );
}
