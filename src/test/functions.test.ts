import { describe, expect, test } from 'bun:test';
import { formatDuration, truncate } from '@/functions';

describe('formatDuration', () => {
  test.each([
    [Number.NaN, 'unknown'],
    [Number.POSITIVE_INFINITY, 'unknown'],
    [-1, 'unknown'],
    [0, '0ms'],
    [999, '999ms'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [1_000, '1.0s'],
    [1_500, '1.5s'],
    [59_000, '59.0s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [60_000, '1m 0s'],
    [90_000, '1m 30s'],
    [3_540_000, '59m 0s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [3_600_000, '1h 0m 0s'],
    [7_530_000, '2h 5m 30s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  describe('carries over at unit boundaries', () => {
    test.each([
      [999.6, '1.0s'],
      [59_999, '1m 0s'],
      [119_600, '2m 0s'],
      [3_599_600, '1h 0m 0s'],
      [7_199_600, '2h 0m 0s'],
    ])('formats %p as %p', (ms, expected) => {
      expect(formatDuration(ms)).toBe(expected);
    });
  });
});

describe('truncate', () => {
  test('leaves text within the budget alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly-10', 10)).toBe('exactly-10');
  });

  test('never returns more than `maxLength` characters', () => {
    for (const maxLength of [0, 1, 5, 20, 22, 30, 50, 100, 2_800]) {
      expect(truncate('a'.repeat(10_000), maxLength).length).toBeLessThanOrEqual(maxLength);
    }
  });

  test('drops the marker when the budget cannot hold it', () => {
    // A marker alone would overshoot, so the budget goes to the text itself.
    expect(truncate('abcdef', 1)).toBe('a');
    expect(truncate('abcdef', 0)).toBe('');
  });

  test('counts the characters trimming removed', () => {
    const text = `${'a'.repeat(30)}${' '.repeat(10)}${'b'.repeat(110)}`;
    const truncated = truncate(text, 60);
    const [kept = '', marker = ''] = truncated.split('\n');

    expect(kept).toBe('a'.repeat(30));
    expect(marker).toBe(`… ${text.length - kept.length} more characters`);
  });

  test('reports how many characters were left out', () => {
    const truncated = truncate('a'.repeat(100), 50);
    const [kept = '', marker = ''] = truncated.split('\n');

    expect(marker).toBe(`… ${100 - kept.length} more characters`);
    expect(kept).toBe('a'.repeat(kept.length));
  });

  test('keeps as much of the text as the budget allows', () => {
    const maxLength = 100;
    const truncated = truncate('a'.repeat(10_000), maxLength);

    // The marker is the only thing allowed to take up the rest of the budget.
    expect(truncated.length).toBeGreaterThan(maxLength - '\n… 10000 more characters'.length - 1);
  });
});
