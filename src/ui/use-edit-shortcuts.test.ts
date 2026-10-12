import { describe, expect, it } from 'vitest';
import type { EditShortcutKeys } from './use-edit-shortcuts';
import { editShortcutFor } from './use-edit-shortcuts';

type Modifiers = Partial<Omit<EditShortcutKeys, 'key'>>;

function press(key: string, modifiers: Modifiers = {}) {
  return editShortcutFor({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

const FOREGROUND = { kind: 'fill', color: 'foreground', preserveTransparency: false };
const BACKGROUND = { kind: 'fill', color: 'background', preserveTransparency: false };

describe('editShortcutFor', () => {
  it('fills with Alt (Option) and Ctrl or Cmd, from Backspace and Delete alike', () => {
    for (const key of ['Backspace', 'Delete']) {
      expect(press(key, { altKey: true })).toEqual(FOREGROUND);
      expect(press(key, { ctrlKey: true })).toEqual(BACKGROUND);
      expect(press(key, { metaKey: true })).toEqual(BACKGROUND);
    }
  });

  it("maps the Mac's delete key, which types Backspace, with Option and Cmd", () => {
    expect(press('Backspace', { altKey: true })).toEqual(FOREGROUND);
    expect(press('Backspace', { metaKey: true })).toEqual(BACKGROUND);
    expect(press('Backspace', { altKey: true, shiftKey: true })).toEqual({
      ...FOREGROUND,
      preserveTransparency: true,
    });
    expect(press('Backspace', { metaKey: true, shiftKey: true })).toEqual({
      ...BACKGROUND,
      preserveTransparency: true,
    });
    expect(press('Backspace')).toEqual({ kind: 'clear' });
  });

  it('preserves transparency with Shift added', () => {
    expect(press('Delete', { altKey: true, shiftKey: true })).toEqual({
      ...FOREGROUND,
      preserveTransparency: true,
    });
    expect(press('Backspace', { ctrlKey: true, shiftKey: true })).toEqual({
      ...BACKGROUND,
      preserveTransparency: true,
    });
  });

  it('opens the Fill dialog with Shift alone, and clears with no modifier', () => {
    expect(press('Backspace', { shiftKey: true })).toEqual({ kind: 'fill-dialog' });
    expect(press('Delete', { shiftKey: true })).toEqual({ kind: 'fill-dialog' });
    expect(press('Backspace')).toEqual({ kind: 'clear' });
    expect(press('Delete')).toEqual({ kind: 'clear' });
  });

  it('leaves AltGr, Cmd+Option and other keys alone', () => {
    expect(press('Backspace', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('Delete', { metaKey: true, altKey: true })).toBeNull();
    expect(press('Delete', { ctrlKey: true, altKey: true, shiftKey: true })).toBeNull();
    expect(press('x', { altKey: true })).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('Escape', { shiftKey: true })).toBeNull();
  });
});
