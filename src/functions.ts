import { stripVTControlCharacters } from 'node:util';
import type { FullResult, TestCase, TestStatus } from '@playwright/test/reporter';

export const getTestTitle = (test: TestCase) => {
  const [_root, _project, _file, ...describesAndTest] = test.titlePath();
  return describesAndTest.join(' > ');
};

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const asyncForEach = async <T>(array: T[], callback: (element: T) => Promise<unknown>): Promise<void> => {
  for (const element of array) {
    await callback(element);
  }
};

export const getTestStatusIcon = (test: TestCase, status: TestStatus): SlackIcon => {
  const outcome = test.outcome();

  if (outcome === 'expected') {
    return SlackIcon.SUCCESS;
  }

  if (outcome === 'flaky') {
    return SlackIcon.FLAKY;
  }

  if (outcome === 'unexpected') {
    return SlackIcon.FAILED;
  }

  if (outcome === 'skipped') {
    return SlackIcon.SKIPPED;
  }

  return getStatusIcon(status);
};

export enum SlackIcon {
  FAILED = ':error:',
  WARNING = '⚠️',
  SUCCESS = ':approved_github:',
  WAITING = '⏳',
  TIMED_OUT = '💤',
  QUESTION = '❓',
  SKIPPED = ':black_right_pointing_double_triangle_with_vertical_bar:',
  TADA = '🎉',
  FLAKY = ':repeat:',
  SLOW = ':hourglass:',
  RUNNING = ':meow_code:',
}

/** Rounds each unit before splitting it into larger ones, so a value near a boundary is not rendered as `1m 60s`. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'unknown';
  }

  if (Math.round(ms) < 1_000) {
    return `${Math.round(ms)}ms`;
  }

  const tenthsOfSeconds = Math.round(ms / 100);

  if (tenthsOfSeconds < 600) {
    return `${(tenthsOfSeconds / 10).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(ms / 1_000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - totalMinutes * 60;

  if (totalMinutes < 60) {
    return `${totalMinutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);

  return `${hours}h ${totalMinutes - hours * 60}m ${seconds}s`;
};

/**
 * Slack renders ANSI escape sequences as garbage. Test output is arbitrary, so more than the colours of
 * Playwright's own errors can turn up in it: spinners hide the cursor with a private mode sequence, and
 * terminal links are OSC. The Node implementation covers all of them.
 */
export const stripAnsi = (text: string): string => stripVTControlCharacters(text);

/**
 * Slack reads `&`, `<` and `>` as control characters wherever it parses mrkdwn: `<!channel>` notifies a whole
 * channel, `<@U012AB3CD>` mentions a user, and `<div class="x">` from a page snapshot is swallowed as a
 * malformed link. Test titles and errors are free text, so they are encoded before they reach such a field.
 *
 * @see {@link https://docs.slack.dev/messaging/formatting-message-text}
 */
export const escapeMrkdwn = (content: string): string =>
  content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const unescapeMrkdwn = (content: string): string =>
  content.replaceAll('`', '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** `chat.postMessage` and `chat.update` reject a `text` longer than this with `msg_too_long`. */
const MAX_TEXT_LENGTH = 4_000;

/** What a character costs once encoded: `&` becomes `&amp;`, and `<` and `>` become `&lt;` and `&gt;`. */
const escapedLength = (char: string | undefined): number => {
  if (char === '&') {
    return '&amp;'.length;
  }

  return char === '<' || char === '>' ? '&lt;'.length : 1;
};

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The text up to `end`, cut where a character ends rather than at the code unit the budget happened to run out
 * on. Cutting into a character leaves half a surrogate pair, which Slack renders as `�`, and cutting into a
 * cluster leaves something that reads as whole but is not what the text said: `🇳🇴` becomes `🇳`, `👍🏽` becomes
 * `👍`, and a decomposed `å` sheds its ring onto the ellipsis marking the cut.
 *
 * Iterated rather than looked up with `containing`, which Bun answers wrongly on an index that is already a
 * boundary, and the tests run on Bun.
 */
const cutAt = (text: string, end: number): string => {
  if (end <= 0) {
    return '';
  }

  if (end >= text.length) {
    return text;
  }

  for (const { index, segment } of GRAPHEMES.segment(text)) {
    // The character the cut falls inside goes with the omitted part rather than being split in two.
    if (index + segment.length > end) {
      return text.slice(0, index);
    }
  }

  return text;
};

/**
 * The top-level `text` of a message, encoded and within the limit Slack holds it to. The blocks carry the
 * message, so this is the notification fallback, but Slack parses it as mrkdwn all the same, and a mobile
 * notification is nothing but this text.
 */
export const toSlackText = (content: string): string => {
  const escaped = escapeMrkdwn(content);

  return escaped.length <= MAX_TEXT_LENGTH ? escaped : `${escapeMrkdwn(cutAt(content, fittingLength(content)))}…`;
};

/**
 * How much of the raw text still fits once encoded, with room to spare for the ellipsis marking the cut. It is
 * the raw text that is cut: cutting the encoded one could land inside an entity and leave a stray `&l` behind.
 *
 * Counted in code units, since that is what the limit is held against, and cut back to a character by `cutAt`.
 */
const fittingLength = (content: string): number => {
  let length = 0;

  for (let index = 0; index < content.length; index++) {
    length += escapedLength(content[index]);

    if (length > MAX_TEXT_LENGTH - 1) {
      return index;
    }
  }

  return content.length;
};

const omittedMarker = (omitted: number) => `\n… ${omitted} more characters`;

/** Free text cut to `max` characters, the marker included. For the fields shown whatever a budget allows. */
export const shorten = (text: string, max: number): string => {
  if (text.length <= max) {
    return text;
  }

  // Too small a budget for even the marker cuts the text bare, rather than overshooting to mark it.
  return max < 1 ? '' : `${cutAt(text, max - 1)}…`;
};

/** Truncates to `maxLength`, marker for the omitted characters included. */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const budget = Math.max(maxLength, 0);

  // The marker counts towards the budget, and is at its longest when it reports the whole length of the text.
  const kept = Math.max(budget - omittedMarker(text.length).length, 0);
  // Trimming drops characters of its own, so the count follows what is actually left rather than `kept`.
  const retained = cutAt(text, kept).trimEnd();
  const marker = omittedMarker(text.length - retained.length);

  // Too small a budget for even the marker, so the text is cut without one rather than overshooting.
  return marker.length > budget ? cutAt(text, budget) : `${retained}${marker}`;
};

const getStatusIcon = (status: TestStatus): SlackIcon => {
  switch (status) {
    case 'failed':
      return SlackIcon.FAILED;
    case 'passed':
      return SlackIcon.SUCCESS;
    case 'timedOut':
      return SlackIcon.TIMED_OUT;
    case 'skipped':
      return SlackIcon.SKIPPED;
    default:
      return SlackIcon.QUESTION;
  }
};

export const getFullStatusIcon = ({ status }: FullResult): SlackIcon => {
  switch (status) {
    case 'failed':
      return SlackIcon.FAILED;
    case 'passed':
      return SlackIcon.SUCCESS;
    case 'timedout':
      return SlackIcon.TIMED_OUT;
    case 'interrupted':
      return SlackIcon.QUESTION;
    default:
      return SlackIcon.QUESTION;
  }
};
