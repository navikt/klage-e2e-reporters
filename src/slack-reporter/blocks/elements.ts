import type { RichTextElement, RichTextText } from '@slack/types';

type TextStyle = NonNullable<RichTextText['style']>;

export const text = (content: string, style?: TextStyle): RichTextText =>
  style === undefined ? { type: 'text', text: content } : { type: 'text', text: content, style };

export const bold = (content: string) => text(content, { bold: true });

export const italic = (content: string) => text(content, { italic: true });

export const code = (content: string) => text(content, { code: true });

/** Renders `:shortcode:` icons as emoji elements and unicode icons as plain text. */
export const icon = (value: string): RichTextElement =>
  value.startsWith(':') && value.endsWith(':') ? { type: 'emoji', name: value.slice(1, -1) } : text(value);
