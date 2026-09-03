import { describe, expect, test } from 'bun:test';
import nodePath from 'node:path';
import type { TestResult } from '@playwright/test/reporter';
import { collectWarnings } from '@/slack-reporter/collect';
import { createResult } from '@/slack-reporter/test/fake-playwright';

const warnings = (attachments: TestResult['attachments']) =>
  collectWarnings(createResult({ duration: 1, attachments }));

describe('collectWarnings', () => {
  test('reads the warning text from the body', () => {
    const attachment = { name: 'warningMessage', contentType: 'text/plain', body: Buffer.from('too slow') };

    expect(warnings([attachment])).toEqual(['too slow']);
  });

  test('strips the colours a warning was written with', () => {
    const attachment = {
      name: 'warningMessage',
      contentType: 'text/plain',
      body: Buffer.from('\u001B[31mred\u001B[0m'),
    };

    expect(warnings([attachment])).toEqual(['red']);
  });

  test('reads a warning whose content type carries a charset', () => {
    const attachment = {
      name: 'warningMessage',
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('too slow'),
    };

    expect(warnings([attachment])).toEqual(['too slow']);
  });

  // Attachment names are free text, so these are files, and `collectUploads` uploads them instead.
  test('ignores a path-backed attachment named like a warning', () => {
    const path = nodePath.join(import.meta.dirname, 'collect.test.ts');

    expect(warnings([{ name: 'warningMessage', contentType: 'text/plain', path }])).toEqual([]);
  });

  test('ignores a binary attachment named like a warning', () => {
    expect(warnings([{ name: 'warningMessage', contentType: 'image/png', body: Buffer.of() }])).toEqual([]);
  });

  test('ignores the media of a failing test', () => {
    const attachment = { name: 'screenshot', contentType: 'image/png', body: Buffer.of() };

    expect(warnings([attachment])).toEqual([]);
  });
});
