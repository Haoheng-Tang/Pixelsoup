import type { ToolManager } from '../tools/tool-manager';
import { useToolOptions, useToolOptionsName } from '../tools/use-active-tool';

/**
 * The bar under the toolbar showing the active tool's name and options, or those of a
 * session that has taken over from it (Free Transform).
 */
export function ToolOptionsBar({ tools }: { tools: ToolManager }) {
  const { OptionsPanel } = useToolOptions(tools);
  const name = useToolOptionsName(tools);
  return (
    <div className="tool-options" role="group" aria-label={`${name} options`}>
      <span className="tool-options-name">{name}</span>
      {OptionsPanel && <OptionsPanel />}
    </div>
  );
}
