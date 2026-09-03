import fs from 'node:fs';
import nodePath from 'node:path';
import type { TestResult } from '@playwright/test/reporter';
import { stripAnsi } from '@/functions';
import { MAX_FILES_PER_MESSAGE, type SlackFileUpload } from '@/slack-client';
import { baseContentType, isWarningAttachment } from '@/slack-reporter/collect';
import { MAX_UPLOAD_BYTES } from '@/slack-reporter/constants';
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
    const file = Buffer.from(errorText, 'utf-8');

    if (withinLimit('error', file.byteLength, notes)) {
      uploads.push({
        file,
        filename: uniqueFilename(filenames, 'error.txt'),
        title: `${test.title} - error`,
      });
    }
  }

  for (const attachment of sortAttachments(failedResult.attachments)) {
    // Its text is reported as a warning instead, but only when `collectWarnings` can read it: anything else under
    // that name is a file, and is uploaded like any other.
    if (isWarningAttachment(attachment)) {
      continue;
    }

    const { name, path, body, contentType } = attachment;

    if (path === undefined) {
      if (body === undefined || !withinLimit(name, body.byteLength, notes)) {
        continue;
      }

      uploads.push({
        file: body,
        filename: uniqueFilename(filenames, `${safeName(name)}${extension(contentType)}`),
        title: `${test.title} - ${name}`,
      });

      continue;
    }

    // A trace can be missing (https://github.com/microsoft/playwright/issues/12711), and one that is there can
    // still be unreadable, so the size is asked for once and either failure leaves the file out with a note.
    let size: number;

    try {
      ({ size } = fs.statSync(path));
    } catch (error) {
      const reason = isMissing(error) ? 'file not found' : 'could not be read';

      notes.push(`${name}: ${reason} (${nodePath.basename(path)})`);
      continue;
    }

    if (!withinLimit(name, size, notes)) {
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

    if (text.trim().length === 0) {
      continue;
    }

    const file = Buffer.from(text, 'utf-8');

    if (withinLimit(name, file.byteLength, notes)) {
      uploads.push({
        file,
        filename: uniqueFilename(filenames, `${name}.txt`),
        title: `${test.title} - ${name}`,
      });
    }
  }

  // The most telling files come first, so the ones dropped by the limit are the least interesting ones.
  if (uploads.length > MAX_FILES_PER_MESSAGE) {
    const dropped = uploads.length - MAX_FILES_PER_MESSAGE;

    notes.push(`${dropped} more files: only ${MAX_FILES_PER_MESSAGE} can be shared on one message`);

    return uploads.slice(0, MAX_FILES_PER_MESSAGE);
  }

  return uploads;
};

/**
 * Playwright attaches its trace as `trace`, which `collectUploads` names `trace.zip`, or `trace-2.zip` and so on
 * when something else took the name first. Attachment names are free text, so anything else that merely starts
 * with `trace` is not one, and must not be offered to `show-trace`.
 */
const TRACE_FILENAME = /^trace(-\d+)?\.zip$/;

export const findTrace = (uploads: SlackFileUpload[]): SlackFileUpload | undefined =>
  uploads.find(({ filename }) => TRACE_FILENAME.test(filename));

const ATTACHMENT_ORDER = ['screenshot', 'video', 'trace'];

/** The artifact Playwright never wrote, told apart from one it wrote but that cannot be read now. */
const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Every file is sent in one batch, so a single oversized one fails all of them: it is left out with a note. */
const withinLimit = (name: string, size: number, notes: string[]): boolean => {
  if (size <= MAX_UPLOAD_BYTES) {
    return true;
  }

  notes.push(`${name}: too large to upload (${Math.round(size / 1024 / 1024)} MB)`);

  return false;
};

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

const extension = (contentType: string) => CONTENT_TYPE_EXTENSIONS[baseContentType(contentType)] ?? '';

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
