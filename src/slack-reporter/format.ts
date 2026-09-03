import type { RichTextBlockElement } from '@slack/types';
import { formatDuration, type SlackIcon, shorten } from '@/functions';
import { type BulletItem, bold, code, icon, italic, section, text } from '@/slack-reporter/blocks';
import { inlineToText, LIST_ITEM_BULLET } from '@/slack-reporter/blocks/fallback';
import type { StepReport } from '@/slack-reporter/types';

/** The first line of a thread message, naming what it is about. */
export const heading = (statusIcon: SlackIcon, label: string, description?: string): RichTextBlockElement =>
  section([
    [icon(statusIcon), bold(` ${label}`), ...(description === undefined ? [] : [text(' '), italic(description)])],
  ]);

export const toStepItems = (steps: StepReport[], indent: number): BulletItem[] =>
  steps.flatMap(({ title, duration, steps: nested }) => [
    { indent, elements: [text(`${title} `), code(formatDuration(duration))] },
    ...toStepItems(nested, indent + 1),
  ]);

/** Every item is rendered with its indentation, bullet and line break, which count towards the message length. */
export const itemLength = ({ indent, elements }: BulletItem) =>
  indent + LIST_ITEM_BULLET.length + inlineToText(elements).length + 1;

/**
 * The note closing a list that was cut short. Its length never grows with a smaller count, so reserving room
 * for the total up front keeps holding once the real count is known.
 */
const andMoreText = (count: number, noun: string) => `and ${count} more ${noun}${count === 1 ? '' : 's'}`;

/** Closes a list that had to be cut short, naming what was left out. */
export const moreItem = (indent: number, count: number, noun: string): BulletItem => ({
  indent,
  elements: [italic(andMoreText(count, noun))],
});

/**
 * Keeps the items that fit both the count limit and the character budget, noting how many were left out. Item
 * titles are free text, so a count on its own does not bound the length of the list.
 */
export const limitItems = (items: BulletItem[], max: number, budget: number): BulletItem[] => {
  const indent = items[0]?.indent ?? 0;
  // The note is only added when something is dropped, but its longest form is reserved from the start, so the
  // budget holds however many items turn out to fit.
  const reserved = itemLength(moreItem(indent, items.length, 'step'));
  const kept: BulletItem[] = [];
  let length = 0;

  for (const item of items) {
    if (kept.length === max) {
      break;
    }

    // The last item needs no room for a note, since nothing is left out once it is in.
    const available = kept.length + 1 === items.length ? budget : budget - reserved;

    if (length + itemLength(item) > available) {
      break;
    }

    kept.push(item);
    length += itemLength(item);
  }

  if (kept.length === items.length) {
    return kept;
  }

  const note = moreItem(indent, items.length - kept.length, 'step');

  // A budget too small for even the note leaves the list out entirely, rather than overshooting to explain it.
  return length + itemLength(note) > budget ? kept : [...kept, note];
};

export const andMore = (count: number, noun: string): RichTextBlockElement[] =>
  count > 0 ? [section([[italic(andMoreText(count, noun))]])] : [];

const MAX_LINE_LENGTH = 200;

/** Warnings and error messages run over several lines, but only the first is listed. */
export const firstLine = (text: string) => {
  const [line = ''] = text.trim().split('\n');

  return shorten(line, MAX_LINE_LENGTH);
};
