import type { Editor } from '../../core';
import type { ContextMenuSections } from '../panels/menu-logic';
import type {
  BrushProperty,
  Tool,
  ToolContext,
  ToolInput,
  ToolKey,
  ToolKeyEvent,
  ToolOverlay,
  ToolPointerEvent,
  ToolSession,
} from './tool';

/** The tools that share a shortcut key, which the toolbar shows as one button. */
export interface ToolGroup {
  readonly key: ToolKey;
  /** In toolbar order. */
  readonly tools: readonly [Tool, ...Tool[]];
}

/**
 * Holds the active tool and routes viewport input to it, or to a session that has taken
 * over from it for a while (`startSession`, e.g. Free Transform). Tool switches (buttons
 * or shortcut keys) are ignored while a pointer gesture is in progress, and apply the
 * editor's pending edit first, which ends such a session; Escape, a cancelled pointer or
 * a document swap abandon the gesture.
 */
export class ToolManager {
  readonly tools: readonly Tool[];
  /** The tools grouped by shortcut key, in toolbar order (each group where its first tool is). */
  readonly groups: readonly ToolGroup[];
  private active: Tool;
  private currentSession: ToolSession | null = null;
  /** Last tool used in each shortcut group, which the group's key selects. */
  private readonly lastInGroup = new Map<ToolKey, Tool>();
  private pointerIsDown = false;
  private readonly toolListeners = new Set<() => void>();
  private readonly overlayListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(text: string) => void>();
  private readonly context: ToolContext;
  private readonly unsubscribeEditor: () => void;

  constructor(
    tools: readonly Tool[],
    private readonly editor: Editor,
  ) {
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
      showMessage: (text) => this.showMessage(text),
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

  /** The session that has taken over the input from the active tool, if any. */
  get session(): ToolSession | null {
    return this.currentSession;
  }

  /** What takes the input now, and whose options the options bar shows: the session or tool. */
  get options(): ToolSession | Tool {
    return this.currentSession ?? this.active;
  }

  /** The cursor over the canvas: the session's, else the active tool's. */
  get cursor(): string {
    return this.input.cursor;
  }

  /** What the session or the active tool wants drawn over the document, if anything. */
  get overlay(): ToolOverlay | null {
    return this.input.overlay ?? null;
  }

  /** True between a pointer down routed to the tool and its pointer up or cancel. */
  get isPointerDown(): boolean {
    return this.pointerIsDown;
  }

  /**
   * Makes the tool with `id` active, after applying the editor's pending edit (even if
   * it's the active tool already). Returns false if a pointer gesture is in progress, in
   * which case nothing changes.
   */
  activate(id: string): boolean {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    if (this.pointerIsDown) return false;
    this.editor.applyPending();
    // Applying the edit normally ends its session, but nothing may outlive a switch.
    if (this.currentSession) this.endSession(this.currentSession);
    if (tool === this.active) return true;

    this.active.cancel?.();
    this.active.deactivate?.();
    this.active = tool;
    this.lastInGroup.set(tool.shortcut, tool);
    tool.activate?.(this.context);
    this.changed();
    return true;
  }

  /**
   * Hands the canvas's input to `session` until `endSession`, leaving the active tool as
   * it is, less any gesture or shape it had in progress. Returns false, changing nothing,
   * during a pointer gesture or while another session runs.
   */
  startSession(session: ToolSession): boolean {
    if (this.pointerIsDown || this.currentSession) return false;
    this.active.cancel?.();
    this.currentSession = session;
    session.activate?.(this.context);
    this.changed();
    return true;
  }

  /** Gives the input back to the active tool, if `session` has it. */
  endSession(session: ToolSession): void {
    if (this.currentSession !== session) return;
    if (this.pointerIsDown) {
      this.pointerIsDown = false;
      session.cancel?.();
    }
    this.currentSession = null;
    session.deactivate?.();
    this.changed();
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

  /** Routes a press: primary presses only (see `ToolPointerEvent.button`). */
  pointerDown(event: ToolPointerEvent): void {
    if ((event.button ?? 0) !== 0) return;
    this.pointerIsDown = true;
    this.input.pointerDown?.(event);
  }

  pointerMove(event: ToolPointerEvent): void {
    this.input.pointerMove?.(event);
  }

  pointerUp(event: ToolPointerEvent): void {
    if (!this.pointerIsDown) return;
    this.pointerIsDown = false;
    this.input.pointerUp?.(event);
  }

  /** Routes a primary double-click, unless a pointer gesture is in progress. */
  doubleClick(event: ToolPointerEvent): void {
    if (this.pointerIsDown || (event.button ?? 0) !== 0) return;
    this.input.doubleClick?.(event);
  }

  /** Abandons the gesture in progress, if any (pointer cancel, blur, document swap). */
  cancel(): void {
    this.pointerIsDown = false;
    this.input.cancel?.();
  }

  /** Routes a key press. Escape cancels a pointer gesture. */
  keyDown(event: ToolKeyEvent): boolean {
    if (event.key === 'Escape' && this.pointerIsDown) {
      this.cancel();
      return true;
    }
    return this.input.keyDown?.(event) ?? false;
  }

  keyUp(event: ToolKeyEvent): boolean {
    return this.input.keyUp?.(event) ?? false;
  }

  /**
   * Steps the active painting tool's brush. Returns false if the tool has no brush, or a
   * session has the input.
   */
  stepBrush(property: BrushProperty, direction: -1 | 1): boolean {
    if (this.currentSession || !this.active.stepBrush) return false;
    this.active.stepBrush(property, direction);
    return true;
  }

  /** The session's or the active tool's own items for the canvas's context menu. */
  contextMenu(): ContextMenuSections {
    return this.input.contextMenu?.() ?? [];
  }

  /** Shows `text` briefly in the status bar. */
  showMessage(text: string): void {
    for (const listener of [...this.messageListeners]) listener(text);
  }

  /** Calls `listener` when the active tool changes, or a session starts or ends. */
  subscribe(listener: () => void): () => void {
    this.toolListeners.add(listener);
    return () => {
      this.toolListeners.delete(listener);
    };
  }

  /** Calls `listener` when the overlay or cursor may have changed. */
  subscribeOverlay(listener: () => void): () => void {
    this.overlayListeners.add(listener);
    return () => {
      this.overlayListeners.delete(listener);
    };
  }

  /** Calls `listener` with each message to show briefly in the status bar. */
  subscribeMessages(listener: (text: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  dispose(): void {
    this.cancel();
    if (this.currentSession) this.endSession(this.currentSession);
    this.active.deactivate?.();
    this.unsubscribeEditor();
    this.toolListeners.clear();
    this.overlayListeners.clear();
    this.messageListeners.clear();
  }

  private get input(): ToolInput {
    return this.currentSession ?? this.active;
  }

  private changed(): void {
    for (const listener of [...this.toolListeners]) listener();
    this.context.overlayChanged();
  }
}
