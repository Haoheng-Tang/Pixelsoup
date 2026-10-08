import type { Editor } from '../../core';
import type { Colors } from '../color/colors';
import { EyedropperOptions } from './eyedropper-options';
import { EyedropperOptionsPanel } from './EyedropperOptionsPanel';
import { EyedropperTool } from './eyedropper-tool';
import { MarqueeTool } from './marquee-tool';
import { MoveOptionsPanel } from './MoveOptionsPanel';
import { MoveTool } from './move-tool';
import { SelectionOptions } from './selection-options';
import { SelectionOptionsPanel } from './SelectionOptionsPanel';
import { ToolManager } from './tool-manager';

/** Creates the app's tools, in toolbar order; the first is active at startup. */
export function createToolManager(editor: Editor, colors: Colors): ToolManager {
  const selectionOptions = new SelectionOptions();
  function SelectionToolOptions() {
    return <SelectionOptionsPanel options={selectionOptions} />;
  }
  const eyedropperOptions = new EyedropperOptions();
  function EyedropperToolOptions() {
    return <EyedropperOptionsPanel options={eyedropperOptions} />;
  }
  return new ToolManager(
    [
      new MarqueeTool('rect', selectionOptions, SelectionToolOptions),
      new MarqueeTool('ellipse', selectionOptions, SelectionToolOptions),
      new MoveTool(MoveOptionsPanel),
      new EyedropperTool(colors, eyedropperOptions, EyedropperToolOptions),
    ],
    editor,
  );
}
