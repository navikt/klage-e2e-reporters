import fs from 'node:fs';
import nodePath from 'node:path';
import type { TestResult } from '@playwright/test/reporter';
import { stripAnsi } from '@/functions';
import type { SlackFileUpload } from '@/slack-client';
import { MAX_UPLOAD_BYTES, MAX_UPLOADS } from '@/slack-reporter/constants';
import { formatError } from '@/slack-reporter/errors';
import type { TestReport } from '@/slack-reporter/types';

/** The media of a failing test, as a single upload. Anything left out is described in `notes`. */
export const collectUploads = (report: TestReport, notes: string[]): SlackFileUpload[] => {
  const { failedResult, test } = report;

  if (failedResult === undefined) {
    return [];
  }

  const uploads: SlackFileUpload[] = [];
  const filenames = new Set<string>();
  const errorText = failedResult.errors.map(formatError).join('\n\n');

  if (errorText.length > 0) {
    uploads.push({
      file: Buffer.from(errorText, 'utf-8'),
      filename: uniqueFilename(filenames, 'error.txt'),
      title: `${test.title} - error`,
    });
  }

  for (const { name, path, body, contentType } of sortAttachments(failedResult.attachments)) {
    if (name === 'warningMessage') {
      continue;
    }

    if (path === undefined) {
      if (body === undefined) {
        continue;
      }

      uploads.push({
        file: body,
        filename: uniqueFilename(filenames, `${safeName(name)}${extension(contentType)}`),
        title: `${test.title} - ${name}`,
      });

      continue;
    }

    // https://github.com/microsoft/playwright/issues/12711
    if (!fs.existsSync(path)) {
      notes.push(`${name}: file not found (${nodePath.basename(path)})`);
      continue;
    }

    const { size } = fs.statSync(path);

    if (size > MAX_UPLOAD_BYTES) {
      notes.push(`${name}: too large to upload (${Math.round(size / 1024 / 1024)} MB)`);
      continue;
    }

    uploads.push({
      file: path,
      filename: uniqueFilename(filenames, `${safeName(name)}${nodePath.extname(path)}`),
      title: `${test.title} - ${name}`,
    });
  }

  for (const [name, output] of [
    ['stdout', failedResult.stdout],
    ['stderr', failedResult.stderr],
  ] as const) {
    const text = stripAnsi(output.map((chunk) => chunk.toString()).join(''));

    if (text.trim().length > 0) {
      uploads.push({
        file: Buffer.from(text, 'utf-8'),
        filename: uniqueFilename(filenames, `${name}.txt`),
        title: `${test.title} - ${name}`,
      });
    }
  }

  // The most telling files come first, so the ones dropped by the limit are the least interesting ones.
  if (uploads.length > MAX_UPLOADS) {
    notes.push(`${uploads.length - MAX_UPLOADS} more files: only ${MAX_UPLOADS} can be shared on one message`);

    return uploads.slice(0, MAX_UPLOADS);
  }

  return uploads;
};

const ATTACHMENT_ORDER = ['screenshot', 'video', 'trace'];

const attachmentRank = ({ name }: TestResult['attachments'][number]) => {
  const index = ATTACHMENT_ORDER.indexOf(name);

  return index === -1 ? ATTACHMENT_ORDER.length : index;
};

const sortAttachments = (attachments: TestResult['attachments']) =>
  [...attachments].sort((a, b) => attachmentRank(a) - attachmentRank(b));

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'application/json': '.json',
  'application/zip': '.zip',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/html': '.html',
  'text/plain': '.txt',
  'video/webm': '.webm',
};

const extension = (contentType: string) => CONTENT_TYPE_EXTENSIONS[contentType.split(';')[0]?.trim() ?? ''] ?? '';

/** Attachment names are free text, so they have to be made usable as filenames. */
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '-').slice(0, 100) || 'attachment';

const uniqueFilename = (used: Set<string>, filename: string): string => {
  if (!used.has(filename)) {
    used.add(filename);

    return filename;
  }

  const ext = nodePath.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);

  let count = 2;
  let candidate = `${base}-${count}${ext}`;

  while (used.has(candidate)) {
    count++;
    candidate = `${base}-${count}${ext}`;
  }

  used.add(candidate);

  return candidate;
};
