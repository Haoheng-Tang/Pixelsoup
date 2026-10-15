import type { ReactNode } from 'react';
import { assertNever } from '../../core';

/** An item in a menu: the menu bar's drop-downs and the canvas's context menu. */
export interface MenuEntry<T extends string> {
  readonly command: T;
  readonly label: string;
  /** Drawn before the label, 16 CSS pixels square: a tool's icon in the toolbar's flyouts. */
  readonly icon?: ReactNode;
  /** Shortcut without the platform modifier, e.g. 'Shift+S' for Ctrl/Cmd+Shift+S. */
  readonly shortcut?: string;
  /** The shortcut takes no Ctrl/Cmd: 'Delete' is the Delete key alone. */
  readonly plain?: boolean;
  readonly disabled?: boolean;
  /** Makes the item a checkbox (`menuitemcheckbox`), ticked when true. */
  readonly checked?: boolean;
  /** With `checked`, the item is one of a set of choices (`menuitemradio`). */
  readonly radio?: boolean;
  /** Makes the item open a submenu of these items, beside it, rather than being chosen. */
  readonly submenu?: MenuSections<T>;
}

/** Groups of items, drawn with separators between them. */
export type MenuSections<T extends string> = readonly (readonly MenuEntry<T>[])[];

/** A context menu item, which carries what it does. */
export interface ContextMenuItem extends MenuEntry<string> {
  readonly run: () => void;
  readonly submenu?: ContextMenuSections;
}

export type ContextMenuSections = readonly (readonly ContextMenuItem[])[];

/** What a key does in an open menu (WAI-ARIA menu pattern). */
export type MenuKeyAction =
  'next' | 'previous' | 'first' | 'last' | 'choose' | 'open' | 'back' | 'close' | 'leave';

/**
 * The arrows move between items, wrapping round, and Home and End go to the first and
 * last; Enter and Space choose the focused item, or open its submenu as the right arrow
 * does, and the left arrow goes back out of a submenu. Escape closes the menu (or just the
 * submenu) and Tab leaves it.
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
    case 'ArrowRight':
      return 'open';
    case 'ArrowLeft':
      return 'back';
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

/**
 * Where a submenu `width` × `height` CSS pixels goes beside its item, whose client rect is
 * `item`: to the right if it fits there, else to the left if it fits there, else on the
 * side with more room. Its first item lines up with `item` (`inset` is the menu's padding
 * and border), moved up as little as needed to stay `margin` inside the window, but never
 * past the top margin. `top` is relative to the item's top.
 */
export function placeSubmenu(
  item: { readonly left: number; readonly right: number; readonly top: number },
  width: number,
  height: number,
  windowWidth: number,
  windowHeight: number,
  { inset = 5, margin = 4 }: { readonly inset?: number; readonly margin?: number } = {},
): { side: 'right' | 'left'; top: number } {
  const roomRight = windowWidth - margin - item.right;
  const roomLeft = item.left - margin;
  const right = width <= roomRight || (width > roomLeft && roomRight >= roomLeft);
  const top = Math.max(margin, Math.min(item.top - inset, windowHeight - margin - height));
  return { side: right ? 'right' : 'left', top: top - item.top };
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
