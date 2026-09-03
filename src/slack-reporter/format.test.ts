import { describe, expect, test } from 'bun:test';
import { type BulletItem, bulletList, text, toFallbackText } from '@/slack-reporter/blocks';
import { andMore, itemLength, limitItems } from '@/slack-reporter/format';

const items = (count: number, titleLength = 10): BulletItem[] =>
  Array.from({ length: count }, (_, index) => ({
    indent: 0,
    elements: [text(`step ${index} `.padEnd(titleLength, 'x'))],
  }));

const render = (kept: BulletItem[]) => toFallbackText(bulletList(kept));

describe('limitItems', () => {
  test('keeps every item that fits both limits', () => {
    const kept = limitItems(items(3), 10, 1_000);

    expect(kept).toHaveLength(3);
    expect(render(kept)).not.toContain('more step');
  });

  test('notes the items the count limit left out', () => {
    expect(render(limitItems(items(5), 2, 1_000))).toContain('and 3 more steps');
  });

  test('names a single omitted item in the singular', () => {
    expect(render(limitItems(items(2), 1, 1_000))).toContain('and 1 more step');
    expect(render(limitItems(items(2), 1, 1_000))).not.toContain('more steps');
  });

  test('stays within the budget when the note is added', () => {
    const all = items(20, 200);
    const budget = 600;
    const kept = limitItems(all, 20, budget);

    expect(kept.length).toBeLessThan(all.length);
    expect(kept.reduce((sum, item) => sum + itemLength(item), 0)).toBeLessThanOrEqual(budget);
  });
});

describe('andMore', () => {
  test('says nothing when nothing was left out', () => {
    expect(andMore(0, 'test')).toHaveLength(0);
  });

  test('names a single omitted item in the singular', () => {
    expect(toFallbackText(andMore(1, 'test'))).toBe('and 1 more test');
  });

  test('names several omitted items in the plural', () => {
    expect(toFallbackText(andMore(4, 'test'))).toBe('and 4 more tests');
  });
});
