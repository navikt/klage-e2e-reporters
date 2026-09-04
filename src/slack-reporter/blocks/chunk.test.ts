import { describe, expect, test } from 'bun:test';
import { bulletList, chunkElements, section, toFallbackText } from '@/slack-reporter/blocks';
import { text } from '@/slack-reporter/blocks/elements';

const MAX_LENGTH = 2_800;

const items = (count: number, indent: number, length = 20) =>
  bulletList(
    Array.from({ length: count }, (_, index) => ({ indent, elements: [text(`item ${index}`.padEnd(length, 'x'))] })),
  );

describe('chunkElements', () => {
  test('keeps every chunk within the budget', () => {
    for (const indent of [0, 1, 4, 8]) {
      for (const chunk of chunkElements(items(600, indent), MAX_LENGTH)) {
        expect(toFallbackText(chunk).length).toBeLessThanOrEqual(MAX_LENGTH);
      }
    }
  });

  test('accounts for the indentation and bullet of each list item', () => {
    // Deeper indentation means fewer items fit, which only holds when the prefixes are measured.
    const flat = chunkElements(items(600, 0), MAX_LENGTH);
    const nested = chunkElements(items(600, 8), MAX_LENGTH);

    expect(nested.length).toBeGreaterThan(flat.length);
  });

  test('keeps every item, in order', () => {
    const chunked = chunkElements(items(600, 3), MAX_LENGTH).flat();
    const lines = chunked.flatMap((element) => toFallbackText([element]).split('\n'));

    expect(lines).toHaveLength(600);
    expect(lines.at(0)).toContain('item 0');
    expect(lines.at(-1)).toContain('item 599');
  });

  test('leaves elements within the budget in a single chunk', () => {
    const elements = [section([[text('short')]]), ...items(3, 0)];

    expect(chunkElements(elements, MAX_LENGTH)).toHaveLength(1);
  });

  test('does not split a list that already fits', () => {
    const [chunk = []] = chunkElements(items(10, 0), MAX_LENGTH);

    expect(chunk).toHaveLength(1);
  });
});
