import { describe, expect, it } from 'vitest';
import { formatShortcut } from './use-file-shortcuts';

describe('formatShortcut', () => {
  it('adds Ctrl, or ⌘ on Apple platforms', () => {
    expect(formatShortcut('S', { apple: false })).toBe('Ctrl+S');
    expect(formatShortcut('Shift+S', { apple: false })).toBe('Ctrl+Shift+S');
    expect(formatShortcut('S', { apple: true })).toBe('⌘S');
    expect(formatShortcut('Shift+S', { apple: true })).toBe('⇧⌘S');
  });

  it('adds nothing to a plain shortcut', () => {
    expect(formatShortcut('Delete', { plain: true, apple: false })).toBe('Delete');
    expect(formatShortcut('Shift+Backspace', { plain: true, apple: false })).toBe(
      'Shift+Backspace',
    );
  });

  it('shows Backspace and Delete as Apple keyboards label them', () => {
    expect(formatShortcut('Backspace', { plain: true, apple: true })).toBe('⌫');
    expect(formatShortcut('Shift+Backspace', { plain: true, apple: true })).toBe('⇧⌫');
    expect(formatShortcut('Delete', { plain: true, apple: true })).toBe('⌦');
    expect(formatShortcut('Backspace', { apple: true })).toBe('⌘⌫');
  });
});
