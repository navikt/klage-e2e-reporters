import type { RichTextBlockElement } from '@slack/types';
import { formatDuration, type SlackIcon } from '@/functions';
import { type BulletItem, bold, code, icon, italic, section, text } from '@/slack-reporter/blocks';
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

export const limitItems = (items: BulletItem[], max: number): BulletItem[] => {
  if (items.length <= max) {
    return items;
  }

  const indent = items[0]?.indent ?? 0;

  return [...items.slice(0, max), { indent, elements: [italic(`and ${items.length - max} more steps`)] }];
};

export const andMore = (count: number, noun: string): RichTextBlockElement[] =>
  count > 0 ? [section([[italic(`and ${count} more ${noun}s`)]])] : [];

/** Warnings and error messages run over several lines, but only the first is listed. */
export const firstLine = (text: string) => {
  const [line = ''] = text.trim().split('\n');

  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};
