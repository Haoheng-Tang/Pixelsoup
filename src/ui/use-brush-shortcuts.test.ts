import { describe, expect, it } from 'vitest';
import { brushStepFor } from './use-brush-shortcuts';

interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function press(key: string, code: string, modifiers: Modifiers = {}) {
  return brushStepFor({
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

describe('brushStepFor', () => {
  it('steps the size with [ and ]', () => {
    expect(press('[', 'BracketLeft')).toEqual({ property: 'size', direction: -1 });
    expect(press(']', 'BracketRight')).toEqual({ property: 'size', direction: 1 });
  });

  it('steps the hardness with Shift, whatever character the layout types', () => {
    expect(press('{', 'BracketLeft', { shiftKey: true })).toEqual({
      property: 'hardness',
      direction: -1,
    });
    expect(press('}', 'BracketRight', { shiftKey: true })).toEqual({
      property: 'hardness',
      direction: 1,
    });
  });

  it('leaves the layer shortcuts, AltGr and other keys alone', () => {
    expect(press('[', 'BracketLeft', { ctrlKey: true })).toBeNull();
    expect(press(']', 'BracketRight', { metaKey: true })).toBeNull();
    expect(press('[', 'BracketLeft', { altKey: true })).toBeNull();
    expect(press('[', 'Digit8', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('b', 'KeyB')).toBeNull();
  });
});
