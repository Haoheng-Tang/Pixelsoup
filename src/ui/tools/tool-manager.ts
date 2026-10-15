import type { Editor } from '../../core';
import type { ContextMenuSections } from '../panels/menu-logic';
import type {
  BrushProperty,
  Tool,
  ToolContext,
  ToolKey,
  ToolKeyEvent,
  ToolOverlay,
  ToolPointerEvent,
} from './tool';

/** The tools that share a shortcut key, which the toolbar shows as one button. */
export interface ToolGroup {
  readonly key: ToolKey;
  /** In toolbar order. */
  readonly tools: readonly [Tool, ...Tool[]];
}

/**
 * Holds the active tool and routes viewport input to it. Tool switches (buttons or
 * shortcut keys) are ignored while a pointer gesture is in progress; Escape, a cancelled
 * pointer or a document swap abandon the gesture.
 */
export class ToolManager {
  readonly tools: readonly Tool[];
  /** The tools grouped by shortcut key, in toolbar order (each group where its first tool is). */
  readonly groups: readonly ToolGroup[];
  private active: Tool;
  /** Last tool used in each shortcut group, which the group's key selects. */
  private readonly lastInGroup = new Map<ToolKey, Tool>();
  private pointerIsDown = false;
  private readonly toolListeners = new Set<() => void>();
  private readonly overlayListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(text: string) => void>();
  private readonly context: ToolContext;
  private readonly unsubscribeEditor: () => void;

  constructor(tools: readonly Tool[], editor: Editor) {
    const first = tools[0];
    if (!first) throw new Error('ToolManager needs at least one tool');
    const ids = new Set(tools.map((tool) => tool.id));
    if (ids.size !== tools.length) throw new Error('Tool IDs must be unique');

    this.tools = tools;
    const groups = new Map<ToolKey, [Tool, ...Tool[]]>();
    for (const tool of tools) {
      const group = groups.get(tool.shortcut);
      if (group) group.push(tool);
      else groups.set(tool.shortcut, [tool]);
    }
    this.groups = [...groups].map(([key, members]) => ({ key, tools: members }));
    this.context = {
      editor,
      overlayChanged: () => {
        for (const listener of [...this.overlayListeners]) listener();
      },
      showMessage: (text) => {
        for (const listener of [...this.messageListeners]) listener(text);
      },
    };
    this.unsubscribeEditor = editor.subscribe((change) => {
      // A gesture in the old canvas's coordinates means nothing on a new or resized one.
      if (change.documentReplaced || change.resized) this.cancel();
    });
    this.active = first;
    first.activate?.(this.context);
  }

  get activeTool(): Tool {
    return this.active;
  }

  /** What the active tool wants drawn over the document, if anything. */
  get overlay(): ToolOverlay | null {
    return this.active.overlay ?? null;
  }

  /** True between a pointer down routed to the tool and its pointer up or cancel. */
  get isPointerDown(): boolean {
    return this.pointerIsDown;
  }

  /**
   * Makes the tool with `id` active. Returns false if a pointer gesture is in progress,
   * in which case nothing changes.
   */
  activate(id: string): boolean {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    if (this.pointerIsDown) return false;
    if (tool === this.active) return true;

    this.active.cancel?.();
    this.active.deactivate?.();
    this.active = tool;
    this.lastInGroup.set(tool.shortcut, tool);
    tool.activate?.(this.context);
    for (const listener of [...this.toolListeners]) listener();
    this.context.overlayChanged();
    return true;
  }

  /**
   * The tool that `group`'s key selects and its toolbar button shows: the one last used,
   * at first the group's first tool. The active tool is always the last used of its group.
   */
  lastUsed(group: ToolGroup): Tool {
    return this.lastInGroup.get(group.key) ?? group.tools[0];
  }

  /**
   * Handles a tool shortcut key (case-insensitive). The key selects the last-used tool of
   * its group; with Shift, while that group is active, it cycles to the group's next
   * tool. Returns true if the key belongs to an existing tool.
   */
  handleShortcut(key: string, shiftKey: boolean): boolean {
    const shortcut = key.toUpperCase();
    const group = this.groups.find((g) => g.key === shortcut);
    if (!group) return false;
    const { tools } = group;
    const current = tools.indexOf(this.active);
    let next: Tool;
    if (current < 0) next = this.lastUsed(group);
    else if (shiftKey) next = tools[(current + 1) % tools.length] ?? tools[0];
    else next = this.active;
    this.activate(next.id);
    return true;
  }

  /** Routes a press to the active tool: primary presses only (see `ToolPointerEvent.button`). */
  pointerDown(event: ToolPointerEvent): void {
    if ((event.button ?? 0) !== 0) return;
    this.pointerIsDown = true;
    this.active.pointerDown?.(event);
  }

  pointerMove(event: ToolPointerEvent): void {
    this.active.pointerMove?.(event);
  }

  pointerUp(event: ToolPointerEvent): void {
    if (!this.pointerIsDown) return;
    this.pointerIsDown = false;
    this.active.pointerUp?.(event);
  }

  /**
   * Routes a primary double-click to the active tool, unless a pointer gesture is in
   * progress.
   */
  doubleClick(event: ToolPointerEvent): void {
    if (this.pointerIsDown || (event.button ?? 0) !== 0) return;
    this.active.doubleClick?.(event);
  }

  /** Abandons the active tool's gesture, if any (pointer cancel, blur, document swap). */
  cancel(): void {
    this.pointerIsDown = false;
    this.active.cancel?.();
  }

  /** Routes a key press to the active tool. Escape cancels a pointer gesture. */
  keyDown(event: ToolKeyEvent): boolean {
    if (event.key === 'Escape' && this.pointerIsDown) {
      this.cancel();
      return true;
    }
    return this.active.keyDown?.(event) ?? false;
  }

  keyUp(event: ToolKeyEvent): boolean {
    return this.active.keyUp?.(event) ?? false;
  }

  /** Steps the active painting tool's brush. Returns false if the tool has no brush. */
  stepBrush(property: BrushProperty, direction: -1 | 1): boolean {
    if (!this.active.stepBrush) return false;
    this.active.stepBrush(property, direction);
    return true;
  }

  /** The active tool's own items for the canvas's context menu (see `Tool.contextMenu`). */
  contextMenu(): ContextMenuSections {
    return this.active.contextMenu?.() ?? [];
  }

  /** Calls `listener` when the active tool changes. */
  subscribe(listener: () => void): () => void {
    this.toolListeners.add(listener);
    return () => {
      this.toolListeners.delete(listener);
    };
  }

  /** Calls `listener` when the active tool's overlay or cursor may have changed. */
  subscribeOverlay(listener: () => void): () => void {
    this.overlayListeners.add(listener);
    return () => {
      this.overlayListeners.delete(listener);
    };
  }

  /** Calls `listener` with each message a tool wants shown briefly in the status bar. */
  subscribeMessages(listener: (text: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  dispose(): void {
    this.cancel();
    this.active.deactivate?.();
    this.unsubscribeEditor();
    this.toolListeners.clear();
    this.overlayListeners.clear();
    this.messageListeners.clear();
  }
}
