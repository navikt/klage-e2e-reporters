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
    return SlackIcon.SKEPTIC;
  }

  if (outcome === 'unexpected') {
    return SlackIcon.WARNING;
  }

  if (outcome === 'skipped') {
    return SlackIcon.QUESTION;
  }

  return getStatusIcon(status);
};

export enum SlackIcon {
  WARNING = '\u26a0\ufe0f',
  SUCCESS = '\u2705',
  WAITING = '\u23f3',
  TIMED_OUT = '\ud83d\udca4',
  QUESTION = '\u2753',
  TADA = '\ud83c\udf89',
  SKEPTIC = '\ud83e\udd14',
  RUNNING = ':meow_code:',
}

const getStatusIcon = (status: TestStatus): SlackIcon => {
  switch (status) {
    case 'failed':
      return SlackIcon.WARNING;
    case 'passed':
      return SlackIcon.SUCCESS;
    case 'timedOut':
      return SlackIcon.TIMED_OUT;
    case 'skipped':
      return SlackIcon.QUESTION;
    default:
      return SlackIcon.QUESTION;
  }
};

export const getFullStatusIcon = ({ status }: FullResult): SlackIcon => {
  switch (status) {
    case 'failed':
      return SlackIcon.WARNING;
    case 'passed':
      return SlackIcon.TADA;
    case 'timedout':
      return SlackIcon.TIMED_OUT;
    case 'interrupted':
      return SlackIcon.QUESTION;
    default:
      return SlackIcon.QUESTION;
  }
};
