import type { Editor } from '../../core';
import type { Colors } from '../color/colors';
import { BrushOptions } from './brush-options';
import { BrushOptionsPanel } from './BrushOptionsPanel';
import { EyedropperOptions } from './eyedropper-options';
import { EyedropperOptionsPanel } from './EyedropperOptionsPanel';
import { EyedropperTool } from './eyedropper-tool';
import { MarqueeTool } from './marquee-tool';
import { MoveOptionsPanel } from './MoveOptionsPanel';
import { MoveTool } from './move-tool';
import { PaintTool } from './paint-tool';
import { SelectionOptions } from './selection-options';
import { SelectionOptionsPanel } from './SelectionOptionsPanel';
import { ToolManager } from './tool-manager';

/** Creates the app's tools, in toolbar order; the first is active at startup. */
export function createToolManager(editor: Editor, colors: Colors): ToolManager {
  const selectionOptions = new SelectionOptions();
  function SelectionToolOptions() {
    return <SelectionOptionsPanel options={selectionOptions} />;
  }
  // Shared by the eyedropper and the painting tools' Alt eyedropper.
  const eyedropperOptions = new EyedropperOptions();
  function EyedropperToolOptions() {
    return <EyedropperOptionsPanel options={eyedropperOptions} />;
  }
  const brushOptions = new BrushOptions({ size: 30 });
  function BrushToolOptions() {
    return <BrushOptionsPanel options={brushOptions} />;
  }
  const eraserOptions = new BrushOptions({ size: 50 });
  function EraserToolOptions() {
    return <BrushOptionsPanel options={eraserOptions} />;
  }
  return new ToolManager(
    [
      new MarqueeTool('rect', selectionOptions, SelectionToolOptions),
      new MarqueeTool('ellipse', selectionOptions, SelectionToolOptions),
      new MoveTool(MoveOptionsPanel),
      new PaintTool('paint', brushOptions, colors, eyedropperOptions, BrushToolOptions),
      new PaintTool('erase', eraserOptions, colors, eyedropperOptions, EraserToolOptions),
      new EyedropperTool(colors, eyedropperOptions, EyedropperToolOptions),
    ],
    editor,
  );
}
