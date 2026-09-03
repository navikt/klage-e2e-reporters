import type { ContextBlock, DividerBlock, HeaderBlock, PlainTextElement, RichTextBlock } from '@slack/types';
import { codeSpan, escapeMrkdwn, mrkdwn } from '@/slack-reporter/blocks/mrkdwn';

/** Narrower than `AnyBlock`, which is not discriminated. */
export type MessageBlock = HeaderBlock | ContextBlock | DividerBlock | RichTextBlock;

/** Slack cuts off header text after 150 characters. */
const MAX_HEADER_LENGTH = 150;

const CONTEXT_SEPARATOR = '  ·  ';

const plainText = (content: string): PlainTextElement => ({ type: 'plain_text', text: content, emoji: true });

export const header = (content: string): HeaderBlock => ({
  type: 'header',
  text: plainText(
    content.length > MAX_HEADER_LENGTH ? `${content.slice(0, MAX_HEADER_LENGTH - 1).trimEnd()}…` : content,
  ),
});

export const divider = (): DividerBlock => ({ type: 'divider' });

export interface ContextPart {
  /** Describes the value. Omit it for a value that speaks for itself. */
  label?: string;
  /** Rendered as inline code, to set it apart from the label. */
  value: string;
}

/** Small, muted text below the message body. The lines are broken by hand, so they do not follow the window width. */
export const context = (lines: ContextPart[][]): ContextBlock => ({
  type: 'context',
  elements: [mrkdwn(lines.map(lineToMrkdwn).join('\n'))],
});

const lineToMrkdwn = (parts: ContextPart[]): string => parts.map(partToMrkdwn).join(CONTEXT_SEPARATOR);

const partToMrkdwn = ({ label, value }: ContextPart): string =>
  label === undefined ? codeSpan(value) : `${escapeMrkdwn(label)} ${codeSpan(value)}`;
