import type { ToolModifiers, ToolPointerEvent, ToolPointerSample } from './tool';
import type { ToolManager } from './tool-manager';

/** For tests: modifier keys to hold, on top of those already held. */
export type Modifiers = Partial<ToolModifiers>;

/** For tests: what a pointer event carries besides its position and modifiers. */
export interface PointerExtras {
  /** Pen pressure, 0–1; leave out for a mouse. */
  readonly pressure?: number;
  /**
   * Screen positions a move passed through before this one, oldest first, reported
   * together with it as coalesced samples.
   */
  readonly via?: readonly (readonly [number, number])[];
}

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

  down(sx: number, sy: number, mods: Modifiers = {}, extras: PointerExtras = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerDown(this.event(sx, sy, extras));
  }

  move(sx: number, sy: number, mods: Modifiers = {}, extras: PointerExtras = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerMove(this.event(sx, sy, extras));
  }

  up(sx: number, sy: number, mods: Modifiers = {}, extras: PointerExtras = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerUp(this.event(sx, sy, extras));
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

  private event(sx: number, sy: number, { pressure, via }: PointerExtras): ToolPointerEvent {
    const sample = (x: number, y: number): ToolPointerSample => ({
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom,
      ...(pressure === undefined ? {} : { pressure }),
    });
    const samples = via && [...via, [sx, sy] as const].map(([x, y]) => sample(x, y));
    return {
      ...sample(sx, sy),
      zoom: this.zoom,
      ...this.held,
      ...(samples ? { samples } : {}),
    };
  }
}
