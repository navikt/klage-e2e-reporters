/**
 * `rich_text` over `mrkdwn` for the message body: it has native lists and is never parsed for markup, so test
 * titles and error messages can not break the formatting. `header` is `plain_text` for the same reason.
 * `context` supports neither, so it is `mrkdwn` with escaped text.
 *
 * @see {@link https://docs.slack.dev/reference/block-kit/blocks/rich-text-block}
 */

export { chunkElements } from '@/slack-reporter/blocks/chunk';
export { bold, code, icon, italic, text } from '@/slack-reporter/blocks/elements';
export { toBlocksFallbackText, toFallbackText } from '@/slack-reporter/blocks/fallback';
export { type ContextPart, context, divider, header, type MessageBlock } from '@/slack-reporter/blocks/message';
export { type BulletItem, bulletList, preformatted, richText, section } from '@/slack-reporter/blocks/rich-text';
