import { describe, expect, it } from 'vitest';
import { createDocument, Editor } from '../../core';
import type {
  BrushProperty,
  Tool,
  ToolContext,
  ToolKey,
  ToolKeyEvent,
  ToolOverlay,
  ToolPointerEvent,
  ToolSession,
} from './tool';
import { ToolManager } from './tool-manager';

/** A tool that records every call it receives. */
class FakeTool implements Tool {
  readonly name: string;
  readonly cursor = 'crosshair';
  readonly calls: string[] = [];
  context: ToolContext | null = null;
  handlesKeys = false;

  constructor(
    readonly id: string,
    readonly shortcut: ToolKey,
  ) {
    this.name = id;
  }

  activate(context: ToolContext): void {
    this.context = context;
    this.calls.push('activate');
  }
  deactivate(): void {
    this.calls.push('deactivate');
  }
  pointerDown(e: ToolPointerEvent): void {
    this.calls.push(`down ${e.x},${e.y}`);
  }
  pointerMove(e: ToolPointerEvent): void {
    this.calls.push(`move ${e.x},${e.y}`);
  }
  pointerUp(e: ToolPointerEvent): void {
    this.calls.push(`up ${e.x},${e.y}`);
  }
  cancel(): void {
    this.calls.push('cancel');
  }
  keyDown(e: ToolKeyEvent): boolean {
    this.calls.push(`keydown ${e.key}`);
    return this.handlesKeys;
  }
  keyUp(e: ToolKeyEvent): boolean {
    this.calls.push(`keyup ${e.key}`);
    return this.handlesKeys;
  }
  stepBrush(property: BrushProperty, direction: -1 | 1): void {
    this.calls.push(`step ${property} ${direction}`);
  }
}

/** A session that records every call it receives. */
class FakeSession implements ToolSession {
  readonly name = 'Session';
  readonly cursor = 'move';
  readonly overlay: ToolOverlay = { shape: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 } };
  readonly calls: string[] = [];

  activate(): void {
    this.calls.push('activate');
  }
  deactivate(): void {
    this.calls.push('deactivate');
  }
  pointerDown(e: ToolPointerEvent): void {
    this.calls.push(`down ${e.x},${e.y}`);
  }
  pointerUp(e: ToolPointerEvent): void {
    this.calls.push(`up ${e.x},${e.y}`);
  }
  cancel(): void {
    this.calls.push('cancel');
  }
  keyDown(e: ToolKeyEvent): boolean {
    this.calls.push(`keydown ${e.key}`);
    return true;
  }
  contextMenu() {
    return [[{ command: 'apply', label: 'Apply', run: () => undefined }]];
  }
}

const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const pointer = (x: number, y: number): ToolPointerEvent => ({ x, y, zoom: 1, ...noModifiers });
const key = (k: string): ToolKeyEvent => ({ key: k, code: '', repeat: false, ...noModifiers });

function setup() {
  const editor = new Editor(createDocument(10, 10));
  const rect = new FakeTool('rect', 'M');
  const ellipse = new FakeTool('ellipse', 'M');
  const brush = new FakeTool('brush', 'B');
  const manager = new ToolManager([rect, ellipse, brush], editor);
  return { editor, manager, rect, ellipse, brush };
}

describe('ToolManager', () => {
  it('needs at least one tool and unique IDs', () => {
    const editor = new Editor(createDocument(1, 1));
    expect(() => new ToolManager([], editor)).toThrow();
    expect(
      () => new ToolManager([new FakeTool('a', 'M'), new FakeTool('a', 'B')], editor),
    ).toThrow();
  });

  it('starts with the first tool active and gives it a context', () => {
    const { manager, rect, editor } = setup();
    expect(manager.activeTool).toBe(rect);
    expect(rect.calls).toEqual(['activate']);
    expect(rect.context?.editor).toBe(editor);
  });

  it('switches tools, deactivating the old one and notifying listeners', () => {
    const { manager, rect, brush } = setup();
    let notified = 0;
    let overlays = 0;
    manager.subscribe(() => notified++);
    manager.subscribeOverlay(() => overlays++);

    expect(manager.activate('brush')).toBe(true);
    expect(manager.activeTool).toBe(brush);
    expect(rect.calls).toEqual(['activate', 'cancel', 'deactivate']);
    expect(brush.calls).toEqual(['activate']);
    expect(notified).toBe(1);
    expect(overlays).toBe(1);

    expect(manager.activate('brush')).toBe(true);
    expect(notified).toBe(1);
    expect(() => manager.activate('nope')).toThrow();
  });

  it('activates tools by shortcut key and cycles a group with Shift', () => {
    const { manager, rect, ellipse, brush } = setup();
    expect(manager.handleShortcut('b', false)).toBe(true);
    expect(manager.activeTool).toBe(brush);
    expect(manager.handleShortcut('m', false)).toBe(true);
    expect(manager.activeTool).toBe(rect);
    expect(manager.handleShortcut('m', false)).toBe(true);
    expect(manager.activeTool).toBe(rect);
    expect(manager.handleShortcut('M', true)).toBe(true);
    expect(manager.activeTool).toBe(ellipse);
    expect(manager.handleShortcut('M', true)).toBe(true);
    expect(manager.activeTool).toBe(rect);
  });

  it("remembers each group's last-used tool", () => {
    const { manager, ellipse } = setup();
    manager.activate('ellipse');
    manager.handleShortcut('b', false);
    manager.handleShortcut('m', false);
    expect(manager.activeTool).toBe(ellipse);
  });

  it('groups the tools by shortcut key, in toolbar order', () => {
    const editor = new Editor(createDocument(10, 10));
    const [rect, brush, ellipse] = [
      new FakeTool('rect', 'M'),
      new FakeTool('brush', 'B'),
      new FakeTool('ellipse', 'M'),
    ];
    const manager = new ToolManager([rect, brush, ellipse], editor);
    expect(manager.groups).toEqual([
      { key: 'M', tools: [rect, ellipse] },
      { key: 'B', tools: [brush] },
    ]);
  });

  it("reports each group's last-used tool, which its key selects", () => {
    const { manager, rect, ellipse, brush } = setup();
    const [marquees, brushes] = manager.groups;
    if (!marquees || !brushes) throw new Error('expected two groups');
    expect(manager.lastUsed(marquees)).toBe(rect);
    expect(manager.lastUsed(brushes)).toBe(brush);
    manager.activate('ellipse');
    expect(manager.lastUsed(marquees)).toBe(ellipse);
    manager.handleShortcut('b', false);
    expect(manager.lastUsed(marquees)).toBe(ellipse);
    manager.handleShortcut('m', false);
    manager.handleShortcut('m', true);
    expect(manager.lastUsed(marquees)).toBe(rect);
    expect(manager.activeTool).toBe(rect);
  });

  it('ignores keys of tools that do not exist yet', () => {
    const { manager, rect } = setup();
    expect(manager.handleShortcut('v', false)).toBe(false);
    expect(manager.handleShortcut('x', false)).toBe(false);
    expect(manager.activeTool).toBe(rect);
  });

  it('routes pointer events to the active tool', () => {
    const { manager, rect } = setup();
    manager.pointerMove(pointer(1, 1));
    manager.pointerDown(pointer(2, 2));
    expect(manager.isPointerDown).toBe(true);
    manager.pointerMove(pointer(3, 3));
    manager.pointerUp(pointer(4, 4));
    expect(manager.isPointerDown).toBe(false);
    manager.pointerUp(pointer(5, 5)); // no matching pointer down: ignored
    expect(rect.calls).toEqual(['activate', 'move 1,1', 'down 2,2', 'move 3,3', 'up 4,4']);
  });

  it('does not switch tools during a pointer gesture', () => {
    const { manager, rect } = setup();
    manager.pointerDown(pointer(0, 0));
    expect(manager.activate('brush')).toBe(false);
    manager.handleShortcut('b', false);
    expect(manager.activeTool).toBe(rect);
    manager.pointerUp(pointer(1, 1));
    expect(manager.activate('brush')).toBe(true);
  });

  it('cancels a gesture on Escape and then ignores its pointer up', () => {
    const { manager, rect } = setup();
    manager.pointerDown(pointer(0, 0));
    expect(manager.keyDown(key('Escape'))).toBe(true);
    expect(manager.isPointerDown).toBe(false);
    manager.pointerUp(pointer(1, 1));
    expect(rect.calls).toEqual(['activate', 'down 0,0', 'cancel']);
  });

  it('routes other keys to the tool and reports whether it used them', () => {
    const { manager, rect } = setup();
    expect(manager.keyDown(key('Shift'))).toBe(false);
    rect.handlesKeys = true;
    expect(manager.keyDown(key('Alt'))).toBe(true);
    expect(manager.keyUp(key('Alt'))).toBe(true);
    expect(rect.calls).toEqual(['activate', 'keydown Shift', 'keydown Alt', 'keyup Alt']);
  });

  it('cancels the gesture when the document is replaced', () => {
    const { manager, rect, editor } = setup();
    manager.pointerDown(pointer(0, 0));
    editor.replaceDocument(createDocument(5, 5));
    expect(manager.isPointerDown).toBe(false);
    expect(rect.calls.at(-1)).toBe('cancel');
  });

  it('forwards overlay changes from the active tool', () => {
    const { manager, rect } = setup();
    let overlays = 0;
    const unsubscribe = manager.subscribeOverlay(() => overlays++);
    rect.context?.overlayChanged();
    expect(overlays).toBe(1);
    unsubscribe();
    rect.context?.overlayChanged();
    expect(overlays).toBe(1);
  });

  it('stops listening to the editor once disposed', () => {
    const { manager, rect, editor } = setup();
    manager.dispose();
    expect(rect.calls).toEqual(['activate', 'cancel', 'deactivate']);
    editor.replaceDocument(createDocument(5, 5));
    expect(rect.calls).toHaveLength(3);
  });

  describe('sessions', () => {
    it('hand the input to the session until it ends', () => {
      const { manager, rect } = setup();
      const session = new FakeSession();
      let changes = 0;
      manager.subscribe(() => changes++);
      expect(manager.startSession(session)).toBe(true);
      expect(rect.calls).toEqual(['activate', 'cancel']);
      expect(session.calls).toEqual(['activate']);
      expect(changes).toBe(1);
      expect(manager.session).toBe(session);
      expect(manager.options).toBe(session);
      expect(manager.activeTool).toBe(rect);
      expect(manager.cursor).toBe('move');
      expect(manager.overlay).toBe(session.overlay);

      manager.pointerDown(pointer(1, 2));
      manager.pointerUp(pointer(3, 4));
      expect(manager.keyDown(key('Enter'))).toBe(true);
      expect(manager.contextMenu()[0]?.[0]?.label).toBe('Apply');
      expect(session.calls).toEqual(['activate', 'down 1,2', 'up 3,4', 'keydown Enter']);
      expect(rect.calls).toEqual(['activate', 'cancel']);

      manager.endSession(session);
      expect(session.calls.at(-1)).toBe('deactivate');
      expect(changes).toBe(2);
      expect(manager.session).toBeNull();
      expect(manager.options).toBe(rect);
      expect(manager.cursor).toBe('crosshair');
      manager.pointerDown(pointer(5, 5));
      expect(rect.calls.at(-1)).toBe('down 5,5');
    });

    it('are refused during a gesture or while another runs', () => {
      const { manager } = setup();
      manager.pointerDown(pointer(0, 0));
      expect(manager.startSession(new FakeSession())).toBe(false);
      manager.pointerUp(pointer(0, 0));
      const first = new FakeSession();
      expect(manager.startSession(first)).toBe(true);
      expect(manager.startSession(new FakeSession())).toBe(false);
      expect(manager.session).toBe(first);
    });

    it('cancel a gesture in progress when they end', () => {
      const { manager } = setup();
      const session = new FakeSession();
      manager.startSession(session);
      manager.pointerDown(pointer(0, 0));
      manager.endSession(session);
      expect(session.calls).toEqual(['activate', 'down 0,0', 'cancel', 'deactivate']);
      expect(manager.isPointerDown).toBe(false);
      // Ending a session that has already ended changes nothing.
      manager.endSession(session);
      expect(session.calls).toHaveLength(4);
    });

    it('keep the brush keys from the active tool', () => {
      const { manager, rect } = setup();
      expect(manager.stepBrush('size', 1)).toBe(true);
      manager.startSession(new FakeSession());
      expect(manager.stepBrush('hardness', 1)).toBe(false);
      expect(rect.calls.filter((c) => c.startsWith('step'))).toEqual(['step size 1']);
    });

    it("end when a tool is chosen, which applies the editor's pending edit first", () => {
      const { manager, editor, rect, brush } = setup();
      const session = new FakeSession();
      const applied: string[] = [];
      const edit = {
        label: 'Edit',
        apply: () => {
          applied.push('apply');
          manager.endSession(session);
        },
        cancel: () => applied.push('cancel'),
      };
      editor.beginPending(edit);
      manager.startSession(session);
      // Choosing the active tool again applies it too.
      expect(manager.activate('rect')).toBe(true);
      expect(applied).toEqual(['apply']);
      expect(manager.session).toBeNull();
      expect(manager.activeTool).toBe(rect);

      editor.beginPending(edit);
      manager.startSession(session);
      expect(manager.activate('brush')).toBe(true);
      expect(applied).toEqual(['apply', 'apply']);
      expect(manager.activeTool).toBe(brush);
      expect(session.calls.filter((c) => c === 'deactivate')).toHaveLength(2);
    });

    it('end, even without a pending edit, when a tool is chosen', () => {
      const { manager } = setup();
      const session = new FakeSession();
      manager.startSession(session);
      manager.activate('brush');
      expect(manager.session).toBeNull();
      expect(session.calls.at(-1)).toBe('deactivate');
    });

    it('end when the manager is disposed', () => {
      const { manager } = setup();
      const session = new FakeSession();
      manager.startSession(session);
      manager.dispose();
      expect(session.calls).toEqual(['activate', 'cancel', 'deactivate']);
    });
  });
});
