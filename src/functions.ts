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

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Slack renders ANSI escape sequences as garbage. */
export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

const omittedMarker = (omitted: number) => `\n… ${omitted} more characters`;

/** Truncates to `maxLength`, marker for the omitted characters included. */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const budget = Math.max(maxLength, 0);

  // The marker counts towards the budget, and is at its longest when it reports the whole length of the text.
  const kept = Math.max(budget - omittedMarker(text.length).length, 0);
  // Trimming drops characters of its own, so the count follows what is actually left rather than `kept`.
  const retained = text.slice(0, kept).trimEnd();
  const marker = omittedMarker(text.length - retained.length);

  // Too small a budget for even the marker, so the text is cut without one rather than overshooting.
  return marker.length > budget ? text.slice(0, budget) : `${retained}${marker}`;
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
