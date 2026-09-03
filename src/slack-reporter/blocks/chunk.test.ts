import { describe, expect, test } from 'bun:test';
import { bulletList, chunkElements, preformatted, section, toFallbackText } from '@/slack-reporter/blocks';
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

  describe('cuts what no chunk could hold whole', () => {
    test.each([
      ['a section', () => [section([[text('x'.repeat(10_000))]])]],
      ['preformatted text', () => [preformatted('x'.repeat(10_000))]],
      ['a single list item', () => items(1, 0, 10_000)],
      ['a list item among items that fit', () => [...items(3, 0), ...items(1, 0, 10_000), ...items(3, 0)]],
      ['a deeply indented list item', () => items(1, 8, 10_000)],
      ['several oversized elements', () => [section([[text('x'.repeat(9_000))]]), ...items(2, 2, 9_000)]],
    ])('%s', (_name, create) => {
      for (const chunk of chunkElements(create(), MAX_LENGTH)) {
        expect(toFallbackText(chunk).length).toBeLessThanOrEqual(MAX_LENGTH);
      }
    });
  });

  test('keeps the elements that fit alongside one that had to be cut', () => {
    const chunked = chunkElements([section([[text('short')]]), ...items(1, 0, 10_000)], MAX_LENGTH).flat();

    expect(toFallbackText(chunked)).toContain('short');
    expect(toFallbackText(chunked)).toContain('item 0');
  });

  test('marks the text it cut', () => {
    const [chunk = []] = chunkElements([section([[text('x'.repeat(10_000))]])], MAX_LENGTH);

    expect(toFallbackText(chunk).endsWith('…')).toBe(true);
  });

  test('keeps whole the inline elements that fit, and drops the rest', () => {
    const elements = [section([[text('kept '), text('x'.repeat(10_000)), text(' dropped')]])];
    const [chunk = []] = chunkElements(elements, MAX_LENGTH);
    const rendered = toFallbackText(chunk);

    expect(rendered.startsWith('kept ')).toBe(true);
    expect(rendered).not.toContain('dropped');
  });
});
