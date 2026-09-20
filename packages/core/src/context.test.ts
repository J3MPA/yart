import { describe, expect, it } from 'vitest';
import { captureContext } from './context';

const CONTENT = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';

describe('captureContext', () => {
  it('captures the target line with symmetric surroundings', () => {
    expect(captureContext(CONTENT, 4, 2)).toEqual({
      before: ['two', 'three'],
      line: 'four',
      after: ['five', 'six'],
    });
  });

  it('truncates at the start of the file rather than padding', () => {
    expect(captureContext(CONTENT, 1, 3)).toEqual({
      before: [],
      line: 'one',
      after: ['two', 'three', 'four'],
    });
  });

  it('truncates at the end of the file rather than padding', () => {
    expect(captureContext(CONTENT, 7, 3)).toEqual({
      before: ['four', 'five', 'six'],
      line: 'seven',
      after: [],
    });
  });

  it('captures the last line when there is no trailing newline', () => {
    expect(captureContext('a\nb', 2, 1).line).toBe('b');
  });

  it('rejects a line past the end of the file', () => {
    expect(() => captureContext(CONTENT, 8)).toThrow(RangeError);
  });

  it('rejects a non-positive line', () => {
    expect(() => captureContext(CONTENT, 0)).toThrow(RangeError);
  });
});
