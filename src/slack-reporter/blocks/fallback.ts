import type { ContextBlock, RichTextBlockElement, RichTextElement } from '@slack/types';
import type { MessageBlock } from '@/slack-reporter/blocks/message';
import { unescapeMrkdwn } from '@/slack-reporter/blocks/mrkdwn';

/** Used as the notification fallback and to measure message length. */
export const toFallbackText = (elements: RichTextBlockElement[]): string => elements.map(elementToText).join('\n');

export const toBlocksFallbackText = (blocks: MessageBlock[]): string =>
  blocks
    .map(blockToText)
    .filter((line) => line.length > 0)
    .join('\n');

const blockToText = (block: MessageBlock): string => {
  switch (block.type) {
    case 'header':
      return block.text.text;
    case 'context':
      return block.elements.map(contextElementToText).join(' ');
    case 'divider':
      return '';
    default:
      return toFallbackText(block.elements);
  }
};

const contextElementToText = (element: ContextBlock['elements'][number]): string => {
  switch (element.type) {
    case 'image':
      return element.alt_text;
    case 'mrkdwn':
      return unescapeMrkdwn(element.text);
    default:
      return element.text;
  }
};

/** Rendered before every list item, after its indentation. Counts towards the message length. */
export const LIST_ITEM_BULLET = '• ';

const elementToText = (element: RichTextBlockElement): string => {
  switch (element.type) {
    case 'rich_text_list':
      return element.elements
        .map(({ elements }) => `${'\t'.repeat(element.indent ?? 0)}${LIST_ITEM_BULLET}${inlineToText(elements)}`)
        .join('\n');
    case 'rich_text_preformatted':
      return inlineToText(element.elements);
    default:
      return inlineToText(element.elements);
  }
};

export const inlineToText = (elements: RichTextElement[]): string =>
  elements
    .map((element) => {
      switch (element.type) {
        case 'text':
          return element.text;
        case 'emoji':
          return `:${element.name}:`;
        case 'link':
          return element.text ?? element.url;
        default:
          return '';
      }
    })
    .join('');
