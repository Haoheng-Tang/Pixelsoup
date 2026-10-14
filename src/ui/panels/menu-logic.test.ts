import { describe, expect, it } from 'vitest';
import { clampMenuPosition, closesContextMenu, menuKeyAction } from './menu-logic';

describe('menuKeyAction', () => {
  it('maps the WAI-ARIA menu keys', () => {
    expect(menuKeyAction('ArrowDown')).toBe('next');
    expect(menuKeyAction('ArrowUp')).toBe('previous');
    expect(menuKeyAction('Home')).toBe('first');
    expect(menuKeyAction('End')).toBe('last');
    expect(menuKeyAction('Enter')).toBe('choose');
    expect(menuKeyAction(' ')).toBe('choose');
    expect(menuKeyAction('Escape')).toBe('close');
    expect(menuKeyAction('Tab')).toBe('leave');
  });

  it('ignores other keys', () => {
    expect(menuKeyAction('a')).toBeNull();
    expect(menuKeyAction('ArrowLeft')).toBeNull();
    expect(menuKeyAction('Backspace')).toBeNull();
  });
});

describe('clampMenuPosition', () => {
  it('puts the top-left corner at the pointer when the menu fits', () => {
    expect(clampMenuPosition(100, 50, 200, 120, 1000, 800)).toEqual({ left: 100, top: 50 });
  });

  it('moves back from the right and bottom edges, keeping the margin', () => {
    // 1000 − 4 − 200 = 796; 800 − 4 − 120 = 676.
    expect(clampMenuPosition(950, 780, 200, 120, 1000, 800)).toEqual({ left: 796, top: 676 });
  });

  it('keeps the margin at the top-left too', () => {
    expect(clampMenuPosition(1, -10, 200, 120, 1000, 800)).toEqual({ left: 4, top: 4 });
  });

  it('pins a menu larger than the window to the top-left margin', () => {
    expect(clampMenuPosition(300, 300, 400, 900, 350, 600, 8)).toEqual({ left: 8, top: 8 });
  });
});

describe('closesContextMenu', () => {
  it('closes on a press or a wheel outside the menu, not inside it', () => {
    expect(closesContextMenu('pointerdown', false)).toBe(true);
    expect(closesContextMenu('pointerdown', true)).toBe(false);
    expect(closesContextMenu('wheel', false)).toBe(true);
    expect(closesContextMenu('wheel', true)).toBe(false);
  });

  it('closes on any scroll, a resize or losing focus', () => {
    for (const inside of [false, true]) {
      expect(closesContextMenu('scroll', inside)).toBe(true);
      expect(closesContextMenu('resize', inside)).toBe(true);
      expect(closesContextMenu('blur', inside)).toBe(true);
    }
  });
});
