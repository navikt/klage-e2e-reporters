import { describe, expect, test } from 'bun:test';
import nodePath from 'node:path';
import type { TestResult } from '@playwright/test/reporter';
import { MAX_FILES_PER_MESSAGE } from '@/slack-client';
import { MAX_UPLOAD_BYTES } from '@/slack-reporter/constants';
import { createResult, createSuite, createTest } from '@/slack-reporter/test/fake-playwright';
import type { TestReport } from '@/slack-reporter/types';
import { collectUploads, findTrace } from '@/slack-reporter/uploads';

const DIRECTORY = import.meta.dirname;

const bodies = (count: number): TestResult['attachments'] =>
  Array.from({ length: count }, (_, index) => ({
    name: `attachment ${index}`,
    contentType: 'text/plain',
    body: Buffer.from(`attachment ${index}`),
  }));

const createReport = (attachments: TestResult['attachments']): TestReport => {
  const failedResult = createResult({ status: 'failed', duration: 1_000, attachments });
  const test = createTest(createSuite(), { title: 'fails', line: 12, results: [failedResult] });

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

describe('findTrace', () => {
  const upload = (filename: string) => ({ file: Buffer.from(filename), filename });

  test('finds the trace among the uploads', () => {
    expect(findTrace([upload('screenshot.png'), upload('trace.zip')])?.filename).toBe('trace.zip');
  });

  test('finds a trace that had to share its name', () => {
    expect(findTrace([upload('trace-2.zip')])?.filename).toBe('trace-2.zip');
  });

  // Attachment names are free text, so `trace-notes` is not a trace Playwright can open.
  test('ignores a file that only looks like a trace', () => {
    expect(findTrace([upload('trace-notes.txt')])).toBeUndefined();
  });

  test('finds nothing among no uploads', () => {
    expect(findTrace([])).toBeUndefined();
  });
});

describe('collectUploads', () => {
  test('keeps every attachment within the limit', () => {
    const notes: string[] = [];
    const uploads = collectUploads(createReport(bodies(MAX_FILES_PER_MESSAGE)), notes);

    expect(uploads).toHaveLength(MAX_FILES_PER_MESSAGE);
    expect(notes).toHaveLength(0);
  });

  test('never returns more files than a message can share', () => {
    const uploads = collectUploads(createReport(bodies(MAX_FILES_PER_MESSAGE + 5)), []);

    expect(uploads).toHaveLength(MAX_FILES_PER_MESSAGE);
  });

  test('notes the files it left out', () => {
    const notes: string[] = [];

    collectUploads(createReport(bodies(MAX_FILES_PER_MESSAGE + 5)), notes);

    expect(notes).toHaveLength(1);
    expect(notes.at(0)).toContain('5 more files');
  });

  test('drops the least telling files first', () => {
    const attachments = [
      ...bodies(MAX_FILES_PER_MESSAGE),
      { name: 'screenshot', contentType: 'image/png', body: Buffer.of() },
    ];
    const uploads = collectUploads(createReport(attachments), []);

    expect(uploads.at(0)?.filename).toBe('screenshot.png');
    expect(uploads.map(({ filename }) => filename)).not.toContain(`attachment-${MAX_FILES_PER_MESSAGE - 1}.txt`);
  });

  test('leaves out an oversized body, so it cannot fail the whole batch', () => {
    const notes: string[] = [];
    const oversized = { name: 'screenshot', contentType: 'image/png', body: Buffer.allocUnsafe(MAX_UPLOAD_BYTES + 1) };
    const uploads = collectUploads(createReport([oversized, ...bodies(1)]), notes);

    expect(uploads.map(({ filename }) => filename)).toEqual(['attachment-0.txt']);
    expect(notes.at(0)).toContain('too large to upload');
  });

  test('notes a path-backed attachment that is gone', () => {
    const notes: string[] = [];
    const missing = { name: 'trace', contentType: 'application/zip', path: nodePath.join(DIRECTORY, 'gone.zip') };
    const uploads = collectUploads(createReport([missing, ...bodies(1)]), notes);

    expect(uploads.map(({ filename }) => filename)).toEqual(['attachment-0.txt']);
    expect(notes).toEqual(['trace: file not found (gone.zip)']);
  });

  test('notes a path-backed attachment it cannot read, rather than losing the whole report', () => {
    const notes: string[] = [];
    // Its parent is this file rather than a directory, so reading the size fails instead of reporting it missing.
    const path = nodePath.join(DIRECTORY, 'uploads.test.ts', 'screenshot.png');
    const uploads = collectUploads(
      createReport([{ name: 'screenshot', contentType: 'image/png', path }, ...bodies(1)]),
      notes,
    );

    expect(uploads.map(({ filename }) => filename)).toEqual(['attachment-0.txt']);
    expect(notes).toEqual(['screenshot: could not be read (screenshot.png)']);
  });

  test('leaves out the warning text, which is reported instead of uploaded', () => {
    const warning = { name: 'warningMessage', contentType: 'text/plain', body: Buffer.from('too slow') };
    const uploads = collectUploads(createReport([warning, ...bodies(1)]), []);

    expect(uploads.map(({ filename }) => filename)).toEqual(['attachment-0.txt']);
  });

  // Attachment names are free text, so one named `warningMessage` that `collectWarnings` cannot read is a file.
  test('uploads a path-backed attachment named like a warning, which is never reported as one', () => {
    const notes: string[] = [];
    const path = nodePath.join(DIRECTORY, 'uploads.test.ts');
    const uploads = collectUploads(createReport([{ name: 'warningMessage', contentType: 'text/plain', path }]), notes);

    expect(uploads.map(({ filename }) => filename)).toEqual(['warningMessage.ts']);
    expect(notes).toHaveLength(0);
  });

  test('uploads a binary attachment named like a warning, which is never reported as one', () => {
    const named = { name: 'warningMessage', contentType: 'image/png', body: Buffer.of() };
    const uploads = collectUploads(createReport([named]), []);

    expect(uploads.map(({ filename }) => filename)).toEqual(['warningMessage.png']);
  });

  test('leaves out a warning whose content type carries a charset, which is reported all the same', () => {
    const warning = {
      name: 'warningMessage',
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('too slow'),
    };
    const uploads = collectUploads(createReport([warning, ...bodies(1)]), []);

    expect(uploads.map(({ filename }) => filename)).toEqual(['attachment-0.txt']);
  });

  test('names a file by its content type, however that was written', () => {
    const named = { name: 'screenshot', contentType: 'IMAGE/PNG', body: Buffer.of() };
    const uploads = collectUploads(createReport([named]), []);

    expect(uploads.map(({ filename }) => filename)).toEqual(['screenshot.png']);
  });
});
