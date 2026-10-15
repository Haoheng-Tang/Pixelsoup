import { assertNever } from '../../core';

/** An item in a menu: the menu bar's drop-downs and the canvas's context menu. */
export interface MenuEntry<T extends string> {
  readonly command: T;
  readonly label: string;
  /** Shortcut without the platform modifier, e.g. 'Shift+S' for Ctrl/Cmd+Shift+S. */
  readonly shortcut?: string;
  /** The shortcut takes no Ctrl/Cmd: 'Delete' is the Delete key alone. */
  readonly plain?: boolean;
  readonly disabled?: boolean;
  /** Makes the item a checkbox (`menuitemcheckbox`), ticked when true. */
  readonly checked?: boolean;
}

/** Groups of items, drawn with separators between them. */
export type MenuSections<T extends string> = readonly (readonly MenuEntry<T>[])[];

/** A context menu item, which carries what it does. */
export interface ContextMenuItem extends MenuEntry<string> {
  readonly run: () => void;
}

export type ContextMenuSections = readonly (readonly ContextMenuItem[])[];

/** What a key does in an open menu (WAI-ARIA menu pattern). */
export type MenuKeyAction = 'next' | 'previous' | 'first' | 'last' | 'choose' | 'close' | 'leave';

/**
 * The arrows move between items, wrapping round, and Home and End go to the first and
 * last; Enter and Space choose the focused item, Escape closes the menu and Tab leaves it.
 */
export function menuKeyAction(key: string): MenuKeyAction | null {
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'choose';
    case 'Escape':
      return 'close';
    case 'Tab':
      return 'leave';
    default:
      return null;
  }
}

/**
 * Where a context menu `width` × `height` CSS pixels opened at (x, y) goes: its top-left
 * corner at the pointer, moved back as little as needed to keep it `margin` inside the
 * window, or against the top-left margin if it's larger than the window.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  windowWidth: number,
  windowHeight: number,
  margin = 4,
): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, windowWidth - margin - width)),
    top: Math.max(margin, Math.min(y, windowHeight - margin - height)),
  };
}

/** Events that may close an open context menu, besides its own keys. */
export type MenuDismissal = 'pointerdown' | 'wheel' | 'scroll' | 'resize' | 'blur';

/**
 * Whether an event closes an open context menu: a press or a wheel outside it, any
 * scroll (the page under it moves), a window resize, or the window losing focus.
 */
export function closesContextMenu(event: MenuDismissal, insideMenu: boolean): boolean {
  switch (event) {
    case 'pointerdown':
    case 'wheel':
      return !insideMenu;
    case 'scroll':
    case 'resize':
    case 'blur':
      return true;
    default:
      return assertNever(event);
  }
}
