import { describe, expect, it } from 'vitest';
import { layerActionFor } from './use-layer-shortcuts';

interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function press(key: string, code: string, modifiers: Modifiers = {}) {
  return layerActionFor({
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

describe('layerActionFor', () => {
  it('maps the Ctrl/Cmd shortcuts', () => {
    expect(press('N', 'KeyN', { ctrlKey: true, shiftKey: true })).toBe('new');
    expect(press('n', 'KeyN', { metaKey: true, shiftKey: true })).toBe('new');
    expect(press('j', 'KeyJ', { ctrlKey: true })).toBe('duplicate');
    expect(press('e', 'KeyE', { metaKey: true })).toBe('merge-down');
    expect(press('[', 'BracketLeft', { ctrlKey: true })).toBe('move-down');
    expect(press(']', 'BracketRight', { metaKey: true })).toBe('move-up');
    expect(press('Enter', 'Enter', { ctrlKey: true })).toBe('commit-floating');
    expect(press('Enter', 'NumpadEnter', { metaKey: true })).toBe('commit-floating');
  });

  it('maps Alt+brackets by key position, since Option+[ types a quote on a Mac', () => {
    expect(press('[', 'BracketLeft', { altKey: true })).toBe('select-below');
    expect(press('“', 'BracketLeft', { altKey: true })).toBe('select-below');
    expect(press('‘', 'BracketRight', { altKey: true })).toBe('select-above');
  });

  it('leaves file shortcuts, AltGr and other combinations alone', () => {
    expect(press('n', 'KeyN', { ctrlKey: true })).toBeNull();
    expect(press('E', 'KeyE', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('J', 'KeyJ', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('{', 'BracketLeft', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('[', 'Digit8', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('{', 'BracketLeft', { altKey: true, shiftKey: true })).toBeNull();
    expect(press('[', 'BracketLeft')).toBeNull();
    expect(press('j', 'KeyJ')).toBeNull();
    expect(press('Enter', 'Enter')).toBeNull();
    expect(press('Enter', 'Enter', { ctrlKey: true, shiftKey: true })).toBeNull();
  });
});
