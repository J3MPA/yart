import { describe, expect, it } from 'vitest';
import { splitLines } from './lines.ts';

describe('splitLines', () => {
  it('returns no lines for empty content', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('treats a trailing newline as a terminator, not a new line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it('handles content without a trailing newline identically', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('preserves interior blank lines', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('preserves a blank line before the terminator', () => {
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });
});
