import type {
  RichTextBlock,
  RichTextBlockElement,
  RichTextElement,
  RichTextList,
  RichTextPreformatted,
  RichTextSection,
} from '@slack/types';
import { text } from '@/slack-reporter/blocks/elements';

/** Slack supports eight levels of list indentation. */
const MAX_INDENT = 8;

/** Slack does not break lines between elements, so the breaks are explicit. Separate sections are paragraphs. */
export const section = (lines: RichTextElement[][]): RichTextSection => ({
  type: 'rich_text_section',
  elements: lines.flatMap((line, index) => (index === 0 ? line : [text('\n'), ...line])),
});

export interface BulletItem {
  /** Nesting level, starting at `0`. */
  indent: number;
  elements: RichTextElement[];
}

/** Slack nests lists by putting consecutive items of the same level in one list element. */
export const bulletList = (items: BulletItem[]): RichTextList[] => {
  const lists: RichTextList[] = [];

  for (const { indent, elements } of items) {
    const level = Math.min(indent, MAX_INDENT);
    const previous = lists.at(-1);

    if (previous?.indent === level) {
      previous.elements.push({ type: 'rich_text_section', elements });
    } else {
      lists.push({
        type: 'rich_text_list',
        style: 'bullet',
        indent: level,
        elements: [{ type: 'rich_text_section', elements }],
      });
    }
  }

  return lists;
};

export const preformatted = (content: string): RichTextPreformatted => ({
  type: 'rich_text_preformatted',
  elements: [{ type: 'text', text: content }],
});

export const richText = (elements: RichTextBlockElement[]): RichTextBlock[] =>
  elements.length === 0 ? [] : [{ type: 'rich_text', elements }];
