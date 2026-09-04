import type { RichTextBlockElement, RichTextList, RichTextSection } from '@slack/types';
import { inlineToText, LIST_ITEM_BULLET, toFallbackText } from '@/slack-reporter/blocks/fallback';

/**
 * Splits the elements into messages within Slack's size limit, never breaking a list item apart. A list that is
 * too long on its own is split into several lists on the same level.
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
    if (element.type === 'rich_text_list' && toFallbackText([element]).length > maxLength) {
      for (const items of splitItems(element, maxLength)) {
        add({ ...element, elements: items });
      }
    } else {
      add(element);
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
    const size = prefix + inlineToText(item.elements).length + 1;

    if (length + size > maxLength && current.length > 0) {
      groups.push(current);
      current = [];
      length = 0;
    }

    current.push(item);
    length += size;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
};
