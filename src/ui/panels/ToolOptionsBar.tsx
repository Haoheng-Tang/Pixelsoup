import type { ToolManager } from '../tools/tool-manager';
import { useActiveTool } from '../tools/use-active-tool';

/** The bar under the toolbar showing the active tool's name and options. */
export function ToolOptionsBar({ tools }: { tools: ToolManager }) {
  const tool = useActiveTool(tools);
  const { OptionsPanel } = tool;
  return (
    <div className="tool-options" role="group" aria-label={`${tool.name} options`}>
      <span className="tool-options-name">{tool.name}</span>
      {OptionsPanel && <OptionsPanel />}
    </div>
  );
}
