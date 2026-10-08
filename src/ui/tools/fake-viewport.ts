import type { ToolModifiers } from './tool';
import type { ToolManager } from './tool-manager';

/** For tests: modifier keys to hold, on top of those already held. */
export type Modifiers = Partial<ToolModifiers>;

export const NO_MODIFIERS: Required<ToolModifiers> = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};

const MODIFIER_KEYS: Partial<Record<string, keyof ToolModifiers>> = {
  Shift: 'shiftKey',
  Alt: 'altKey',
  Control: 'ctrlKey',
  Meta: 'metaKey',
};

/**
 * Stands in for the viewport in tests: maps screen (CSS pixel) coordinates to document
 * space with `doc = (screen - pan) / zoom` and feeds the ToolManager as the real one does.
 * Modifiers given to a pointer method stay held until released.
 */
export class FakeViewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  private held: Required<ToolModifiers> = { ...NO_MODIFIERS };

  constructor(readonly tools: ToolManager) {}

  down(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerDown(this.event(sx, sy));
  }

  move(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerMove(this.event(sx, sy));
  }

  up(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerUp(this.event(sx, sy));
  }

  /** Press, move to the end point, release, with the same modifiers throughout. */
  drag(x0: number, y0: number, x1: number, y1: number, mods: Modifiers = {}): void {
    this.down(x0, y0, mods);
    this.move(x1, y1);
    this.up(x1, y1);
    this.held = { ...this.held, shiftKey: false, altKey: false };
  }

  /**
   * Presses a key. Modifier keys (Shift, Alt, Control, Meta) stay held until `keyUp`;
   * `mods` apply to this key press only.
   */
  keyDown(key: string, mods: Modifiers = {}): boolean {
    const modifier = MODIFIER_KEYS[key];
    if (modifier) this.held = { ...this.held, [modifier]: true };
    return this.tools.keyDown({ key, code: key, repeat: false, ...this.held, ...mods });
  }

  keyUp(key: string, mods: Modifiers = {}): boolean {
    const modifier = MODIFIER_KEYS[key];
    if (modifier) this.held = { ...this.held, [modifier]: false };
    return this.tools.keyUp({ key, code: key, repeat: false, ...this.held, ...mods });
  }

  private event(sx: number, sy: number) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
      zoom: this.zoom,
      ...this.held,
    };
  }
}
