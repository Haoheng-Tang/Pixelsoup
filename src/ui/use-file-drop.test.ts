import { describe, expect, it } from 'vitest';
import { isFileDrag } from './use-file-drop';

describe('isFileDrag', () => {
  it('is true only for drags that carry files', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['application/x-moz-file', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'text/uri-list'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });
});
