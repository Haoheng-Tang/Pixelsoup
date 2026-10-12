import type { Editor } from '../../core';
import type { Colors } from '../color/colors';
import { BrushOptions } from './brush-options';
import { BrushOptionsPanel } from './BrushOptionsPanel';
import { CropOptions } from './crop-options';
import { CropOptionsPanel } from './CropOptionsPanel';
import { CropTool } from './crop-tool';
import { EyedropperOptions } from './eyedropper-options';
import { EyedropperOptionsPanel } from './EyedropperOptionsPanel';
import { EyedropperTool } from './eyedropper-tool';
import { LassoTool, PolygonLassoTool } from './lasso-tool';
import { MagicWandTool } from './magic-wand-tool';
import { MarqueeTool } from './marquee-tool';
import { MoveOptionsPanel } from './MoveOptionsPanel';
import { MoveTool } from './move-tool';
import { PaintTool } from './paint-tool';
import { RegionOptions } from './region-options';
import { RegionOptionsPanel } from './RegionOptionsPanel';
import { SelectionOptions } from './selection-options';
import { SelectionOptionsPanel } from './SelectionOptionsPanel';
import { ToolManager } from './tool-manager';

/** Creates the app's tools, in toolbar order; the first is active at startup. */
export function createToolManager(editor: Editor, colors: Colors): ToolManager {
  const selectionOptions = new SelectionOptions();
  function SelectionToolOptions() {
    return <SelectionOptionsPanel options={selectionOptions} />;
  }
  function LassoToolOptions() {
    return (
      <SelectionOptionsPanel
        options={selectionOptions}
        hint="Drag around an area. Hold Alt as you release for straight segments."
      />
    );
  }
  function PolygonLassoToolOptions() {
    return (
      <SelectionOptionsPanel
        options={selectionOptions}
        hint="Click to add points; close on the first point, by double-clicking or with Enter. Backspace takes back a point."
      />
    );
  }
  const wandOptions = new RegionOptions();
  function MagicWandToolOptions() {
    return (
      <>
        <SelectionOptionsPanel options={selectionOptions} />
        <RegionOptionsPanel options={wandOptions} />
      </>
    );
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
  const cropOptions = new CropOptions();
  const cropTool = new CropTool(cropOptions, CropToolOptions);
  function CropToolOptions() {
    return <CropOptionsPanel options={cropOptions} tool={cropTool} />;
  }
  return new ToolManager(
    [
      new MarqueeTool('rect', selectionOptions, SelectionToolOptions),
      new MarqueeTool('ellipse', selectionOptions, SelectionToolOptions),
      new LassoTool(selectionOptions, LassoToolOptions),
      new PolygonLassoTool(selectionOptions, PolygonLassoToolOptions),
      new MagicWandTool(selectionOptions, wandOptions, MagicWandToolOptions),
      new MoveTool(MoveOptionsPanel),
      new PaintTool('paint', brushOptions, colors, eyedropperOptions, BrushToolOptions),
      new PaintTool('erase', eraserOptions, colors, eyedropperOptions, EraserToolOptions),
      new EyedropperTool(colors, eyedropperOptions, EyedropperToolOptions),
      cropTool,
    ],
    editor,
  );
}
