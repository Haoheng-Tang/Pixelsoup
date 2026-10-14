import { describe, expect, it } from 'vitest';
import type { ClipboardShortcutKeys } from './use-clipboard-shortcuts';
import { clipboardShortcutFor } from './use-clipboard-shortcuts';

function keys(key: string, modifiers: Partial<ClipboardShortcutKeys> = {}): ClipboardShortcutKeys {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('clipboardShortcutFor', () => {
  it('maps Ctrl and Cmd with X, C, Shift+C and V', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(clipboardShortcutFor(keys('x', modifier))).toBe('cut');
      expect(clipboardShortcutFor(keys('c', modifier))).toBe('copy');
      expect(clipboardShortcutFor(keys('C', { ...modifier, shiftKey: true }))).toBe('copy-merged');
      expect(clipboardShortcutFor(keys('v', modifier))).toBe('paste');
      // Caps Lock gives capitals without Shift.
      expect(clipboardShortcutFor(keys('X', modifier))).toBe('cut');
    }
  });

  it('ignores the keys without Ctrl or Cmd, with Alt or AltGr, and other combinations', () => {
    expect(clipboardShortcutFor(keys('c'))).toBeNull();
    expect(clipboardShortcutFor(keys('C', { shiftKey: true }))).toBeNull();
    expect(clipboardShortcutFor(keys('c', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(clipboardShortcutFor(keys('v', { metaKey: true, altKey: true }))).toBeNull();
    expect(clipboardShortcutFor(keys('X', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(clipboardShortcutFor(keys('V', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(clipboardShortcutFor(keys('z', { ctrlKey: true }))).toBeNull();
  });
});
