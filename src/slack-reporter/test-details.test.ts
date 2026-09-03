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

const createReport = (failedSteps: StepReport[], errors: TestError[], title = 'fails'): TestReport => {
  const failedResult = createResult({ status: 'failed', duration: 1_000, errors });
  const test = createTest(createSuite(), { title, line: 12, outcome: 'unexpected', results: [failedResult] });

  return {
    test,
    result: failedResult,
    failedResult,
    title,
    project: 'fake',
    location: `${test.location.file}:12`,
    duration: 1_000,
    attempts: 1,
    failedSteps,
    slowSteps: [],
    warnings: [],
  };
};

const notes = (count: number, length: number) =>
  Array.from({ length: count }, (_, index) => `note ${index} `.padEnd(length, 'x'));

const trace = [{ file: Buffer.from('trace'), filename: 'trace.zip' }];

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

  test('keeps the message within the budget, whatever the report holds', () => {
    const title = 'fails '.padEnd(1_000, 'x');
    const cases: [string, TestReport, string[]][] = [
      ['steps', createReport(steps(30, 200), []), []],
      ['title', createReport(steps(30, 200), [], title), []],
      ['notes', createReport(steps(30, 200), []), notes(12, 300)],
      ['everything', createReport(steps(30, 200), [error(50_000)], title), notes(12, 300)],
    ];

    for (const [name, report, reportNotes] of cases) {
      expect(toFallbackText(formatTestDetails(report, trace, reportNotes)).length, name).toBeLessThanOrEqual(
        MAX_MESSAGE_LENGTH,
      );
    }
  });

  test('notes the steps the budget left out', () => {
    const elements = formatTestDetails(createReport(steps(15, 250), []), [], []);

    expect(toFallbackText(elements)).toContain('more steps');
  });

  test('keeps a report that fits whole', () => {
    const report = createReport(steps(3, 20), [error(50)]);
    const text = toFallbackText(formatTestDetails(report, trace, ['screenshot: file not found']));

    expect(text).toContain('step 0');
    expect(text).toContain('step 2');
    expect(text).toContain('npx playwright show-trace trace.zip');
    expect(text).toContain('screenshot: file not found');
    expect(text).not.toContain('more steps');
  });

  test('leaves out the trace command when there is no trace to open', () => {
    const elements = formatTestDetails(createReport(steps(1, 20), [error(50)]), [], []);

    expect(toFallbackText(elements)).not.toContain('show-trace');
  });

  test('leaves out the trace command for a file that only looks like a trace', () => {
    // Attachment names are free text, so `trace-notes` is not a trace Playwright can open.
    const uploads = [{ file: Buffer.from('notes'), filename: 'trace-notes.txt' }];
    const elements = formatTestDetails(createReport(steps(1, 20), [error(50)]), uploads, []);

    expect(toFallbackText(elements)).not.toContain('show-trace');
  });

  test('opens a trace that had to share its name', () => {
    const uploads = [{ file: Buffer.from('trace'), filename: 'trace-2.zip' }];
    const elements = formatTestDetails(createReport(steps(1, 20), [error(50)]), uploads, []);

    expect(toFallbackText(elements)).toContain('npx playwright show-trace trace-2.zip');
  });

  test('keeps the message within the budget when the project and path are long', () => {
    const report = createReport(steps(3, 40), [error(5_000)]);
    const long = { ...report, project: 'p'.repeat(3_000), location: `${'directory/'.repeat(500)}klage.spec.ts:12` };

    expect(toFallbackText(formatTestDetails(long, trace, [])).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });
});
