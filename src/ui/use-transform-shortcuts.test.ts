import { describe, expect, it } from 'vitest';
import { isFreeTransformKey } from './use-transform-shortcuts';

interface Press {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function matches(press: Press): boolean {
  return isFreeTransformKey({
    code: `Key${press.key.toUpperCase()}`,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...press,
  });
}

describe('isFreeTransformKey', () => {
  it('matches Ctrl+Alt+T, and Cmd+Option+T on a Mac', () => {
    expect(matches({ key: 't', ctrlKey: true, altKey: true })).toBe(true);
    expect(matches({ key: 'T', ctrlKey: true, altKey: true })).toBe(true);
    expect(matches({ key: 't', metaKey: true, altKey: true })).toBe(true);
  });

  it('matches the T key where Option or AltGr types another character with it', () => {
    expect(matches({ key: '†', code: 'KeyT', metaKey: true, altKey: true })).toBe(true);
    expect(matches({ key: 'þ', code: 'KeyT', ctrlKey: true, altKey: true })).toBe(true);
    // A layout that puts another letter on the T key (Dvorak's Y) goes by the letter.
    expect(matches({ key: 'y', code: 'KeyT', ctrlKey: true, altKey: true })).toBe(false);
    expect(matches({ key: 't', code: 'KeyK', ctrlKey: true, altKey: true })).toBe(true);
  });

  it('leaves Ctrl/Cmd+T to the browser, and ignores Shift and other keys', () => {
    expect(matches({ key: 't', ctrlKey: true })).toBe(false);
    expect(matches({ key: 't', metaKey: true })).toBe(false);
    expect(matches({ key: 't', altKey: true })).toBe(false);
    expect(matches({ key: 't' })).toBe(false);
    expect(matches({ key: 't', ctrlKey: true, altKey: true, shiftKey: true })).toBe(false);
    expect(matches({ key: 'y', ctrlKey: true, altKey: true })).toBe(false);
    expect(matches({ key: '5', code: 'Digit5', ctrlKey: true, altKey: true })).toBe(false);
  });
});
