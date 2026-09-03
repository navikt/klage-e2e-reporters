import type { MrkdwnElement } from '@slack/types';

/** `verbatim` keeps Slack from turning URLs, channel names and mentions in the values into links. */
export const mrkdwn = (content: string): MrkdwnElement => ({ type: 'mrkdwn', text: content, verbatim: true });

/** Slack has no escape for a backtick inside a code span, so they are replaced with a lookalike. */
export const codeSpan = (value: string): string =>
  value.length === 0 ? '' : `\`${escapeMrkdwn(value.replaceAll('`', 'ʼ').replaceAll('\n', ' '))}\``;

export const escapeMrkdwn = (content: string): string =>
  content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const unescapeMrkdwn = (content: string): string =>
  content.replaceAll('`', '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
