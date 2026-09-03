import { describe, expect, test } from 'bun:test';
import type { TestError } from '@playwright/test/reporter';
import { toFallbackText } from '@/slack-reporter/blocks';
import { MAX_MESSAGE_LENGTH } from '@/slack-reporter/constants';
import { createResult, createSuite, createTest } from '@/slack-reporter/test/fake-playwright';
import { formatTestDetails } from '@/slack-reporter/test-details';
import type { StepReport, TestReport } from '@/slack-reporter/types';

const error = (length: number): TestError => ({ message: 'Error: '.padEnd(length, 'x') });

const steps = (count: number, length: number): StepReport[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `step ${index} `.padEnd(length, 'x'),
    duration: 1_000,
    steps: [],
  }));

const createReport = (failedSteps: StepReport[], errors: TestError[]): TestReport => {
  const failedResult = createResult({ status: 'failed', duration: 1_000, errors });
  const test = createTest(createSuite(), { title: 'fails', line: 12, outcome: 'unexpected', results: [failedResult] });

  return {
    test,
    result: failedResult,
    failedResult,
    title: 'fails',
    project: 'fake',
    location: `${test.location.file}:12`,
    duration: 1_000,
    attempts: 1,
    failedSteps,
    slowSteps: [],
    warnings: [],
  };
};

const hasErrorBlock = (elements: ReturnType<typeof formatTestDetails>) =>
  elements.some(({ type }) => type === 'rich_text_preformatted');

describe('formatTestDetails', () => {
  test('includes the errors when the budget allows', () => {
    const elements = formatTestDetails(createReport(steps(3, 40), [error(5_000)]), [], []);

    expect(hasErrorBlock(elements)).toBe(true);
  });

  test('keeps the message within the budget', () => {
    for (const length of [10, 200, 2_000, 5_000, 50_000]) {
      const elements = formatTestDetails(createReport(steps(3, 40), [error(length)]), [], []);

      expect(toFallbackText(elements).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  test('leaves the errors out when the steps have spent the budget', () => {
    const elements = formatTestDetails(createReport(steps(20, 250), [error(5_000)]), [], []);

    expect(hasErrorBlock(elements)).toBe(false);
  });
});
