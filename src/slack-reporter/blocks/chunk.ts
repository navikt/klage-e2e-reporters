import type { RichTextBlockElement, RichTextElement, RichTextList, RichTextSection } from '@slack/types';
import { shorten } from '@/functions';
import { inlineToText, LIST_ITEM_BULLET, toFallbackText } from '@/slack-reporter/blocks/fallback';

/** Everything but a list, whose items are sections of their own and are fitted one by one. */
type LeafElement = Exclude<RichTextBlockElement, RichTextList>;

/**
 * Splits the elements into messages within Slack's size limit, never breaking a list item apart. A list that is
 * too long on its own is split into several lists on the same level, and anything that fills a whole message by
 * itself is cut short, since no chunk could hold it whole and Slack rejects a message over the limit.
 */
export const chunkElements = (elements: RichTextBlockElement[], maxLength: number): RichTextBlockElement[][] => {
  const chunks: RichTextBlockElement[][] = [];
  let current: RichTextBlockElement[] = [];
  let length = 0;

  const add = (element: RichTextBlockElement) => {
    const size = toFallbackText([element]).length + 1;

    if (length + size > maxLength && current.length > 0) {
      chunks.push(current);
      current = [];
      length = 0;
    }

    current.push(element);
    length += size;
  };

  for (const element of elements) {
    if (element.type === 'rich_text_list') {
      // A list that already fits comes back as a single group, so it is passed on whole.
      for (const items of splitItems(element, maxLength)) {
        add({ ...element, elements: items });
      }
    } else {
      add(fitElement(element, maxLength));
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

const splitItems = (list: RichTextList, maxLength: number): RichTextSection[][] => {
  const groups: RichTextSection[][] = [];
  let current: RichTextSection[] = [];
  let length = 0;
  // Every item is rendered with its indentation and bullet, which count towards the message length too.
  const prefix = (list.indent ?? 0) + LIST_ITEM_BULLET.length;

  for (const item of list.elements) {
    // Splitting a list cannot help an item that is too long on its own, so that one is cut instead.
    const fitted = fitItem(item, maxLength - prefix - 1);
    const size = prefix + inlineToText(fitted.elements).length + 1;

    if (length + size > maxLength && current.length > 0) {
      groups.push(current);
      current = [];
      length = 0;
    }

    current.push(fitted);
    length += size;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
};

/** Cuts an element that fills a message on its own. The line break before it counts towards the message too. */
const fitElement = (element: LeafElement, maxLength: number): LeafElement => {
  const budget = maxLength - 1;

  if (toFallbackText([element]).length <= budget) {
    return element;
  }

  // The two branches are the same, but each has to be narrowed on its own: preformatted text holds a narrower
  // set of inline elements than a section or a quote, and a shared branch widens them into one.
  return element.type === 'rich_text_preformatted'
    ? { ...element, elements: fitInline(element.elements, budget) }
    : { ...element, elements: fitInline(element.elements, budget) };
};

const fitItem = (item: RichTextSection, budget: number): RichTextSection =>
  inlineToText(item.elements).length <= budget ? item : { ...item, elements: fitInline(item.elements, budget) };

/** The inline elements that fit the budget, the last of them cut short when only a part of it fits. */
const fitInline = <T extends RichTextElement>(elements: T[], budget: number): T[] => {
  const kept: T[] = [];
  let length = 0;

  for (const element of elements) {
    const size = inlineToText([element]).length;

    if (length + size <= budget) {
      kept.push(element);
      length += size;
      continue;
    }

    const room = budget - length;

    // Only text can be cut in the middle: an emoji or a mention is kept whole or left out.
    if (element.type === 'text' && room > 0) {
      kept.push({ ...element, text: shorten(element.text, room) });
    }

    break;
  }

  return kept;
};
