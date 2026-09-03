import { describe, expect, test } from 'bun:test';
import { escapeMrkdwn, formatDuration, shorten, stripAnsi, toSlackText, truncate, unescapeMrkdwn } from '@/functions';

/** Half a surrogate pair, left behind by a cut between the two code units a character is made of. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A grinning face, one character of two code units. */
const EMOJI = '\u{1F600}';
/** The flag of Norway, one character of two regional indicators. */
const FLAG = '\u{1F1F3}\u{1F1F4}';
/** A family, one character of three joined by zero width joiners. */
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
/** A decomposed `å`: the letter and its ring are separate code points. */
const DECOMPOSED = 'a\u030A';

describe('formatDuration', () => {
  test.each([
    [Number.NaN, 'unknown'],
    [Number.POSITIVE_INFINITY, 'unknown'],
    [-1, 'unknown'],
    [0, '0ms'],
    [999, '999ms'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [1_000, '1.0s'],
    [1_500, '1.5s'],
    [59_000, '59.0s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [60_000, '1m 0s'],
    [90_000, '1m 30s'],
    [3_540_000, '59m 0s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  test.each([
    [3_600_000, '1h 0m 0s'],
    [7_530_000, '2h 5m 30s'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  describe('carries over at unit boundaries', () => {
    test.each([
      [999.6, '1.0s'],
      [59_999, '1m 0s'],
      [119_600, '2m 0s'],
      [3_599_600, '1h 0m 0s'],
      [7_199_600, '2h 0m 0s'],
    ])('formats %p as %p', (ms, expected) => {
      expect(formatDuration(ms)).toBe(expected);
    });
  });
});

describe('truncate', () => {
  test('leaves text within the budget alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly-10', 10)).toBe('exactly-10');
  });

  test('never returns more than `maxLength` characters', () => {
    for (const maxLength of [0, 1, 5, 20, 22, 30, 50, 100, 2_800]) {
      expect(truncate('a'.repeat(10_000), maxLength).length).toBeLessThanOrEqual(maxLength);
    }
  });

  test('drops the marker when the budget cannot hold it', () => {
    // A marker alone would overshoot, so the budget goes to the text itself.
    expect(truncate('abcdef', 1)).toBe('a');
    expect(truncate('abcdef', 0)).toBe('');
  });

  test('counts the characters trimming removed', () => {
    const text = `${'a'.repeat(30)}${' '.repeat(10)}${'b'.repeat(110)}`;
    const truncated = truncate(text, 60);
    const [kept = '', marker = ''] = truncated.split('\n');

    expect(kept).toBe('a'.repeat(30));
    expect(marker).toBe(`… ${text.length - kept.length} more characters`);
  });

  test('reports how many characters were left out', () => {
    const truncated = truncate('a'.repeat(100), 50);
    const [kept = '', marker = ''] = truncated.split('\n');

    expect(marker).toBe(`… ${100 - kept.length} more characters`);
    expect(kept).toBe('a'.repeat(kept.length));
  });

  test('keeps as much of the text as the budget allows', () => {
    const maxLength = 100;
    const truncated = truncate('a'.repeat(10_000), maxLength);

    // The marker is the only thing allowed to take up the rest of the budget.
    expect(truncated.length).toBeGreaterThan(maxLength - '\n… 10000 more characters'.length - 1);
  });

  test('never cuts a character in half, at any budget', () => {
    const text = `x${EMOJI}`.repeat(30);

    for (let maxLength = 0; maxLength <= text.length; maxLength++) {
      expect(truncate(text, maxLength)).not.toMatch(LONE_SURROGATE);
    }
  });
});

describe('shorten', () => {
  test('leaves text within the budget alone', () => {
    expect(shorten('short', 10)).toBe('short');
    expect(shorten('exactly-10', 10)).toBe('exactly-10');
  });

  test('never returns more than `max` characters', () => {
    for (const max of [0, 1, 2, 5, 20, 100]) {
      expect(shorten('a'.repeat(1_000), max).length).toBeLessThanOrEqual(max);
    }
  });

  test('cuts the text bare when the budget cannot hold the marker', () => {
    expect(shorten('abcdef', 0)).toBe('');
  });

  test('drops a character the budget cannot hold whole', () => {
    // The budget reaches into the emoji, which is left out rather than cut in half.
    expect(shorten(`ab${EMOJI}cd`, 4)).toBe('ab…');
    expect(shorten(`ab${EMOJI}cd`, 4)).not.toMatch(LONE_SURROGATE);
  });

  test('keeps a character the budget ends exactly on', () => {
    expect(shorten(`ab${EMOJI}cd`, 5)).toBe(`ab${EMOJI}…`);
  });

  test('never leaves part of a character behind', () => {
    // Half a flag is another flag, and a ring without its letter lands on the ellipsis.
    expect(shorten(`${FLAG} test`, 3)).toBe('…');
    expect(shorten(`${FLAG} test`, 5)).toBe(`${FLAG}…`);
    expect(shorten(`${FAMILY}x`, 8)).toBe('…');
    expect(shorten(`b${DECOMPOSED}rd`, 3)).toBe('b…');
  });
});

describe('stripAnsi', () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);

  test('removes the colours Playwright writes its errors in', () => {
    expect(stripAnsi(`${ESC}[31mExpected 1${ESC}[39m`)).toBe('Expected 1');
  });

  test('removes the sequences test output holds beyond colours', () => {
    // A spinner hides the cursor with a CSI private mode, and a terminal link is OSC.
    expect(stripAnsi(`${ESC}[?25lworking${ESC}[?25h`)).toBe('working');
    expect(stripAnsi(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`)).toBe('link');
  });

  test('leaves text without escape sequences alone', () => {
    expect(stripAnsi('Error: expected 1 to be 2')).toBe('Error: expected 1 to be 2');
  });
});

describe('escapeMrkdwn', () => {
  test('encodes every control character Slack parses', () => {
    expect(escapeMrkdwn('<!channel>')).toBe('&lt;!channel&gt;');
    expect(escapeMrkdwn('<@U012AB3CD>')).toBe('&lt;@U012AB3CD&gt;');
    expect(escapeMrkdwn('a & b')).toBe('a &amp; b');
  });

  test('encodes the ampersand before it can be read as part of an entity', () => {
    expect(escapeMrkdwn('&lt;!channel&gt;')).toBe('&amp;lt;!channel&amp;gt;');
  });

  test('leaves text without control characters alone', () => {
    expect(escapeMrkdwn('login > submits the form')).toBe('login &gt; submits the form');
    expect(escapeMrkdwn('Error: expected 1 to be 2')).toBe('Error: expected 1 to be 2');
  });

  test('round trips', () => {
    const text = 'login <!channel> & <@U012AB3CD> > done';

    expect(unescapeMrkdwn(escapeMrkdwn(text))).toBe(text);
  });
});

describe('toSlackText', () => {
  test('encodes the mentions an error could otherwise smuggle into a notification', () => {
    expect(toSlackText('expected <!channel> to be <@U012AB3CD>')).toBe(
      'expected &lt;!channel&gt; to be &lt;@U012AB3CD&gt;',
    );
  });

  test('never returns more than the 4000 characters Slack allows', () => {
    for (const char of ['a', '<', '>', '&']) {
      expect(toSlackText(char.repeat(10_000)).length).toBeLessThanOrEqual(4_000);
    }
  });

  test('cuts the raw text, so the encoding is never left half written', () => {
    const cut = toSlackText('<'.repeat(10_000));

    expect(cut.endsWith('&lt;…')).toBe(true);
    // Every character but the ellipsis belongs to a whole entity.
    expect((cut.length - 1) % '&lt;'.length).toBe(0);
  });

  test('leaves text within the limit unmarked', () => {
    expect(toSlackText('a'.repeat(4_000))).toBe('a'.repeat(4_000));
    expect(toSlackText('a'.repeat(4_001)).endsWith('…')).toBe(true);
  });

  test('never sends half a character to a notification', () => {
    // The limit falls between the two code units of the first emoji.
    const cut = toSlackText(`${'a'.repeat(3_998)}${EMOJI.repeat(10)}`);

    expect(cut).not.toMatch(LONE_SURROGATE);
    expect(cut.endsWith('a…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(4_000);
  });
});
