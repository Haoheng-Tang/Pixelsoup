import { describe, expect, it } from 'vitest';
import { formatShortcut } from './use-file-shortcuts';

describe('formatShortcut', () => {
  it('adds Ctrl, or ⌘ on Apple platforms', () => {
    expect(formatShortcut('S', { apple: false })).toBe('Ctrl+S');
    expect(formatShortcut('Shift+S', { apple: false })).toBe('Ctrl+Shift+S');
    expect(formatShortcut('S', { apple: true })).toBe('⌘S');
    expect(formatShortcut('Shift+S', { apple: true })).toBe('⇧⌘S');
  });

  it('puts Alt (⌥) in the platform’s order', () => {
    expect(formatShortcut('Alt+T', { apple: false })).toBe('Ctrl+Alt+T');
    expect(formatShortcut('Alt+T', { apple: true })).toBe('⌥⌘T');
    expect(formatShortcut('Alt+Shift+T', { apple: false })).toBe('Ctrl+Alt+Shift+T');
    expect(formatShortcut('Alt+Shift+T', { apple: true })).toBe('⌥⇧⌘T');
    expect(formatShortcut('Alt+Backspace', { plain: true, apple: false })).toBe('Alt+Backspace');
    expect(formatShortcut('Alt+Backspace', { plain: true, apple: true })).toBe('⌥⌫');
  });

  it('adds nothing to a plain shortcut', () => {
    expect(formatShortcut('Delete', { plain: true, apple: false })).toBe('Delete');
    expect(formatShortcut('Shift+Backspace', { plain: true, apple: false })).toBe(
      'Shift+Backspace',
    );
    expect(formatShortcut('Escape', { plain: true, apple: false })).toBe('Esc');
  });

  it('shows Backspace and Delete as Apple keyboards label them', () => {
    expect(formatShortcut('Backspace', { plain: true, apple: true })).toBe('⌫');
    expect(formatShortcut('Shift+Backspace', { plain: true, apple: true })).toBe('⇧⌫');
    expect(formatShortcut('Delete', { plain: true, apple: true })).toBe('⌦');
    expect(formatShortcut('Enter', { plain: true, apple: true })).toBe('↩');
    expect(formatShortcut('Escape', { plain: true, apple: true })).toBe('⎋');
    expect(formatShortcut('Backspace', { apple: true })).toBe('⌘⌫');
  });
});
