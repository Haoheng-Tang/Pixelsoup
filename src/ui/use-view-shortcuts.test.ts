import { describe, expect, it } from 'vitest';
import { viewCommandFor } from './use-view-shortcuts';
import { ViewOptions, runViewCommand } from './viewport/view-options';

interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function press(key: string, modifiers: Modifiers = {}) {
  return viewCommandFor({
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

describe('viewCommandFor', () => {
  it('maps Ctrl+H, and Cmd+H on a Mac, to Extras', () => {
    expect(press('h', { ctrlKey: true })).toBe('extras');
    expect(press('H', { ctrlKey: true })).toBe('extras');
    expect(press('h', { metaKey: true })).toBe('extras');
  });

  it('ignores H without Ctrl/Cmd, or with Shift or Alt (AltGr)', () => {
    expect(press('h')).toBeNull();
    expect(press('h', { shiftKey: true })).toBeNull();
    expect(press('h', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('h', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('h', { metaKey: true, altKey: true })).toBeNull();
    expect(press('g', { ctrlKey: true })).toBeNull();
  });
});

describe('ViewOptions', () => {
  it('shows Extras until toggled, and tells subscribers', () => {
    const view = new ViewOptions();
    let calls = 0;
    view.subscribe(() => calls++);
    expect(view.showExtras).toBe(true);
    runViewCommand(view, 'extras');
    expect(view.showExtras).toBe(false);
    expect(view.revision).toBe(1);
    view.setShowExtras(false);
    expect(calls).toBe(1);
    runViewCommand(view, 'extras');
    expect(view.showExtras).toBe(true);
    expect(calls).toBe(2);
  });
});
