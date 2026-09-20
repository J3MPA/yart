import { describe, expect, it } from 'vitest';
import { buildLineMap } from './line-map';

describe('buildLineMap', () => {
  it('maps every line when content is identical', () => {
    const map = buildLineMap('a\nb\nc\n', 'a\nb\nc\n');
    expect([...map]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('shifts lines down when content is inserted above them', () => {
    const map = buildLineMap('a\nb\n', 'x\ny\na\nb\n');
    expect(map.get(1)).toBe(3);
    expect(map.get(2)).toBe(4);
  });

  it('shifts lines up when content is removed above them', () => {
    const map = buildLineMap('x\ny\na\nb\n', 'a\nb\n');
    expect(map.get(3)).toBe(1);
    expect(map.get(4)).toBe(2);
  });

  it('drops a deleted line while keeping its neighbours', () => {
    const map = buildLineMap('a\nb\nc\n', 'a\nc\n');
    expect(map.get(1)).toBe(1);
    expect(map.has(2)).toBe(false);
    expect(map.get(3)).toBe(2);
  });

  it('drops a modified line, since a line diff reports it as delete plus insert', () => {
    const map = buildLineMap('a\nb\nc\n', 'a\nB\nc\n');
    expect(map.has(2)).toBe(false);
    expect(map.get(1)).toBe(1);
    expect(map.get(3)).toBe(3);
  });

  it('keeps the final line when only one side lacks a trailing newline', () => {
    const map = buildLineMap('a\nb', 'a\nb\nc\n');
    expect(map.get(2)).toBe(2);
  });

  it('survives a pure reindent by default', () => {
    const map = buildLineMap('if (x) {\nf();\n}\n', 'if (x) {\n  f();\n}\n');
    expect(map.get(2)).toBe(2);
  });

  it('outdates a reindented line when whitespace is significant', () => {
    const map = buildLineMap('if (x) {\nf();\n}\n', 'if (x) {\n  f();\n}\n', {
      ignore_whitespace: false,
    });
    expect(map.has(2)).toBe(false);
  });

  it('drops a line that becomes blank even when ignoring whitespace', () => {
    const map = buildLineMap('a\nb\nc\n', 'a\n\nc\n');
    expect(map.has(2)).toBe(false);
  });

  it('maps nothing when the file is emptied', () => {
    expect([...buildLineMap('a\nb\n', '')]).toEqual([]);
  });

  it('maps nothing when a file is created from nothing', () => {
    expect([...buildLineMap('', 'a\nb\n')]).toEqual([]);
  });
});
