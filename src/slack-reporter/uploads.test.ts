import { describe, expect, test } from 'bun:test';
import type { TestResult } from '@playwright/test/reporter';
import { MAX_UPLOADS } from '@/slack-reporter/constants';
import { createResult, createSuite, createTest } from '@/slack-reporter/test/fake-playwright';
import type { TestReport } from '@/slack-reporter/types';
import { collectUploads } from '@/slack-reporter/uploads';

const bodies = (count: number): TestResult['attachments'] =>
  Array.from({ length: count }, (_, index) => ({
    name: `attachment ${index}`,
    contentType: 'text/plain',
    body: Buffer.from(`attachment ${index}`),
  }));

const createReport = (attachments: TestResult['attachments']): TestReport => {
  const failedResult = createResult({ status: 'failed', duration: 1_000, attachments });
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
    failedSteps: [],
    slowSteps: [],
    warnings: [],
  };
};

describe('collectUploads', () => {
  test('keeps every attachment within the limit', () => {
    const notes: string[] = [];
    const uploads = collectUploads(createReport(bodies(MAX_UPLOADS)), notes);

    expect(uploads).toHaveLength(MAX_UPLOADS);
    expect(notes).toHaveLength(0);
  });

  test('never returns more files than a message can share', () => {
    const uploads = collectUploads(createReport(bodies(MAX_UPLOADS + 5)), []);

    expect(uploads).toHaveLength(MAX_UPLOADS);
  });

  test('notes the files it left out', () => {
    const notes: string[] = [];

    collectUploads(createReport(bodies(MAX_UPLOADS + 5)), notes);

    expect(notes).toHaveLength(1);
    expect(notes.at(0)).toContain('5 more files');
  });

  test('drops the least telling files first', () => {
    const attachments = [...bodies(MAX_UPLOADS), { name: 'screenshot', contentType: 'image/png', body: Buffer.of() }];
    const uploads = collectUploads(createReport(attachments), []);

    expect(uploads.at(0)?.filename).toBe('screenshot.png');
    expect(uploads.map(({ filename }) => filename)).not.toContain(`attachment-${MAX_UPLOADS - 1}.txt`);
  });
});
