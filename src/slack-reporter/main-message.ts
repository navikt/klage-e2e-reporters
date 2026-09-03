import type { FullResult } from '@playwright/test/reporter';
import type { RichTextElement } from '@slack/types';
import { formatDuration, getFullStatusIcon, SlackIcon } from '@/functions';
import {
  type BulletItem,
  bold,
  bulletList,
  code,
  context,
  divider,
  header,
  icon,
  italic,
  type MessageBlock,
  richText,
  section,
  text,
  toBlocksFallbackText,
} from '@/slack-reporter/blocks';
import { MAX_MESSAGE_LENGTH, MAX_RUNNING_TESTS, PROGRESS_WIDTH } from '@/slack-reporter/constants';
import { firstLine, itemLength, moreItem } from '@/slack-reporter/format';
import { type Trigger, triggerParts } from '@/slack-reporter/trigger';
import type { Counts, RunningTest } from '@/slack-reporter/types';

/** The state of the run at the moment the main message is rendered. */
export interface RunState {
  counts: Counts;
  /** Finished tests. */
  done: number;
  total: number;
  workers: number;
  elapsed: number;
  /** Longest running first. */
  running: RunningTest[];
}

/** The bar along the left edge of the main message, telling the status apart at a glance. */
enum StatusColor {
  RUNNING = '#1d9bd1',
  PASSED = '#2eb886',
  FAILED = '#a30200',
  UNKNOWN = '#daa038',
}

export interface Headline {
  icon: SlackIcon;
  color: StatusColor;
  label: string;
}

export interface MainMessage {
  blocks: MessageBlock[];
  color: StatusColor;
}

interface CountEntry {
  icon: SlackIcon;
  value: number;
  label: string;
  /** Already spelled out by the headline, so it is not worth a row of its own. */
  inHeadline?: boolean;
}

/**
 * The main message, updated while the run is in progress and given a headline once it is finished.
 *
 * Three tiers, so the eye can jump to the level it cares about: the headline says how the run went, the body
 * holds the numbers it left out, and the muted context lines carry the metadata. Dividers fence the body off,
 * and are left out along with it when a run has nothing to add to its headline.
 */
export const formatMainMessage = (
  { counts, done, total, workers, elapsed, running }: RunState,
  trigger: Trigger,
  headline?: Headline,
): MainMessage => {
  const { passed, flaky, failed, skipped } = counts;
  const notRun = total - done;
  const finished = headline !== undefined;
  const { repository, branch, actor, version } = triggerParts(trigger);

  const entries: CountEntry[] = [
    { icon: SlackIcon.SUCCESS, value: passed, label: 'passed', inHeadline: true },
    { icon: SlackIcon.FLAKY, value: flaky, label: 'flaky' },
    { icon: SlackIcon.FAILED, value: failed, label: 'failed' },
    { icon: SlackIcon.SKIPPED, value: skipped, label: 'skipped' },
    ...(finished && notRun > 0 ? [{ icon: SlackIcon.TIMED_OUT, value: notRun, label: 'not run' }] : []),
  ];

  const countElements: RichTextElement[][] = listedCounts(entries, finished).map(
    ({ icon: statusIcon, value, label }) => [icon(statusIcon), text(' '), bold(`${value}`), text(` ${label}`)],
  );

  // The bar is always full at the end of a complete run.
  const showProgress = (!finished || notRun > 0) && total > 0;

  const summary: RichTextElement[][] = [
    ...(countElements.length === 0
      ? []
      : [countElements.flatMap((count, index) => (index === 0 ? count : [text('  ·  '), ...count]))]),
    ...(showProgress ? [[code(progressBar(done, total))]] : []),
  ];

  const {
    icon: statusIcon,
    color,
    label,
  } = headline ?? {
    icon: SlackIcon.RUNNING,
    color: StatusColor.RUNNING,
    label: `Running ${done}/${total} tests`,
  };

  const summarySection = summary.length === 0 ? [] : [section(summary)];

  const metadata = context([
    [repository, branch, actor],
    [
      { label: `${SlackIcon.WAITING} ${finished ? 'total time' : 'elapsed'}`, value: formatDuration(elapsed) },
      version,
      { label: 'workers', value: `${workers}` },
    ],
  ]);

  const headerBlock = header(`${statusIcon} ${label}`);

  // Test titles are free text and the list grows with the run, so it is the one part of this message that has to
  // be fitted: Slack rejects a message that is too long outright, and this one is sent again every few seconds.
  // The dividers cost nothing, so they are left out of the measurement.
  const spent = toBlocksFallbackText([headerBlock, ...richText(summarySection), metadata]).length;
  const items = finished ? [] : runningItems(running, MAX_MESSAGE_LENGTH - spent);

  const body = richText([...summarySection, ...bulletList(items)]);

  return {
    color,
    blocks: [
      headerBlock,
      // Slack hides everything past the fifth block of an attachment behind a "Show more" button, so all the
      // metadata shares one context block: header, divider, body, divider, context.
      ...(body.length === 0 ? [] : [divider(), ...body, divider()]),
      metadata,
    ],
  };
};

/**
 * While the run is in progress every outcome is listed, so the row keeps its shape as the numbers move. Once it
 * is over the zeros are only noise, and a run where everything passed drops the row, since the headline already
 * counted the tests.
 */
const listedCounts = (entries: CountEntry[], finished: boolean): CountEntry[] => {
  if (!finished) {
    return entries;
  }

  const notable = entries.filter(({ value }) => value > 0);

  return notable.every(({ inHeadline }) => inHeadline === true) ? [] : notable;
};

/**
 * The tests in progress, as many as the count limit and the character budget allow. A test and the step it is
 * on belong together, so they are listed or left out as one.
 */
const runningItems = (running: RunningTest[], budget: number): BulletItem[] => {
  // The note is only added when something is left out, but its longest form is reserved from the start, so the
  // budget holds however many tests turn out to fit.
  const reserved = itemLength(moreItem(0, running.length, 'test'));
  const items: BulletItem[] = [];
  let listed = 0;
  let length = 0;

  for (const test of running) {
    if (listed === MAX_RUNNING_TESTS) {
      break;
    }

    const rows = testRows(test);
    const rowsLength = rows.reduce((total, item) => total + itemLength(item), 0);
    // The last test needs no room for a note, since nothing is left out once it is in.
    const available = listed + 1 === running.length ? budget : budget - reserved;

    if (length + rowsLength > available) {
      break;
    }

    items.push(...rows);
    length += rowsLength;
    listed++;
  }

  const rest = running.length - listed;

  if (rest === 0) {
    return items;
  }

  const note = moreItem(0, rest, 'test');

  // A budget too small for even the note leaves the list out entirely, rather than overshooting to explain it.
  return length + itemLength(note) > budget ? items : [...items, note];
};

const testRows = ({ title, step, elapsed }: RunningTest): BulletItem[] => [
  { indent: 0, elements: [text(`${firstLine(title)} `), code(formatDuration(elapsed))] },
  ...(step === undefined ? [] : [{ indent: 1, elements: [italic(step)] }]),
];

export const getHeadline = (result: FullResult, state: RunState): Headline => ({
  icon: getFullStatusIcon(result),
  color: getStatusColor(result),
  label: headlineLabel(result, state),
});

const getStatusColor = ({ status }: FullResult): StatusColor => {
  switch (status) {
    case 'passed':
      return StatusColor.PASSED;
    case 'failed':
    case 'timedout':
      return StatusColor.FAILED;
    default:
      return StatusColor.UNKNOWN;
  }
};

const headlineLabel = (
  result: FullResult,
  { counts: { passed, failed, flaky, skipped }, done, total }: RunState,
): string => {
  switch (result.status) {
    case 'passed': {
      // Skipped tests never ran, so they are reported separately instead of counted as passed.
      const ran = passed + flaky;
      const notes = [...(flaky > 0 ? [`${flaky} flaky`] : []), ...(skipped > 0 ? [`${skipped} skipped`] : [])];

      return notes.length === 0 ? `All ${ran} tests passed!` : `All ${ran} tests passed (${notes.join(', ')}).`;
    }
    case 'failed':
      return `${failed} of ${total} tests failed!`;
    case 'timedout':
      return `Global timeout! ${failed} of ${total} tests failed!`;
    case 'interrupted':
      return `Interrupted! ${failed} of ${total} tests failed!`;
    default:
      return `Finished ${done} of ${total} tests.`;
  }
};

/** The percentage is padded, so the bar keeps its width between updates. */
const progressBar = (done: number, total: number): string => {
  const fraction = Math.min(Math.max(done / total, 0), 1);
  const filled = Math.round(fraction * PROGRESS_WIDTH);

  return `${'█'.repeat(filled)}${'░'.repeat(PROGRESS_WIDTH - filled)}${`${Math.round(fraction * 100)}%`.padStart(5)}`;
};
