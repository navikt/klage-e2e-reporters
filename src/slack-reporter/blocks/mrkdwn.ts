import type { MrkdwnElement } from '@slack/types';
import { escapeMrkdwn } from '@/functions';

/** `verbatim` keeps Slack from turning URLs, channel names and mentions in the values into links. */
export const mrkdwn = (content: string): MrkdwnElement => ({ type: 'mrkdwn', text: content, verbatim: true });

export const codeSpan = (value: string): string => {
  // Slack has no escape for a backtick inside a code span, so they are dropped rather than left to end it early.
  const content = value.replaceAll('`', '').replaceAll('\n', ' ');

  return content.length === 0 ? '' : `\`${escapeMrkdwn(content)}\``;
};
