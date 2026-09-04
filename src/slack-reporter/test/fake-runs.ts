import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import type { Suite, TestCase, TestError } from '@playwright/test/reporter';
import { createResult, createStep, createTest, FILE } from '@/slack-reporter/test/fake-playwright';

/** The fake runs the reporter is taken through, and the files they "produced". */

/** A single transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** An empty, but valid, zip archive. */
const EMPTY_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);

/** Writes the files the fake run "produced" to a temporary directory. */
export const createAttachments = (): string => {
  const directory = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'slack-reporter-test-'));

  fs.writeFileSync(nodePath.join(directory, 'screenshot.png'), PNG);
  fs.writeFileSync(nodePath.join(directory, 'video.webm'), Buffer.from('not really a video'));
  fs.writeFileSync(nodePath.join(directory, 'trace.zip'), EMPTY_ZIP);

  return directory;
};

const ASSERTION_ERROR: TestError = {
  message: [
    'Error: expect(locator).toBeVisible() failed',
    '',
    "Locator: getByRole('heading', { name: 'Kvittering' })",
    'Expected: visible',
    'Received: <element(s) not found>',
    'Timeout:  5000ms',
  ].join('\n'),
  snippet: [
    "  41 |   await page.getByRole('button', { name: 'Send inn' }).click();",
    "> 42 |   await expect(page.getByRole('heading', { name: 'Kvittering' })).toBeVisible();",
    '     |                                                                   ^',
  ].join('\n'),
  stack: [
    'Error: expect(locator).toBeVisible() failed',
    `    at Object.<anonymous> (${FILE}:42:67)`,
    '    at TestStepImpl._runStep (playwright/lib/worker/testInfo.js:1:1)',
  ].join('\n'),
  location: { file: FILE, line: 42, column: 67 },
};

const TIMEOUT_ERROR: TestError = {
  message: 'Test timeout of 60000ms exceeded while waiting for the PDF to be generated.',
  stack: `Error: Test timeout of 60000ms exceeded.\n    at Object.<anonymous> (${FILE}:88:5)`,
};

export const createFailedRun = (suite: Suite, directory: string): TestCase[] => [
  createTest(suite, {
    title: 'logger inn som saksbehandler',
    line: 12,
    outcome: 'expected',
    results: [
      createResult({
        duration: 4_200,
        steps: [
          createStep(['Logg inn'], 'test.step', 3_800, undefined, [
            createStep(['Logg inn', 'page.goto'], 'pw:api', 1_100),
          ]),
        ],
      }),
    ],
  }),

  createTest(suite, {
    title: 'oppretter en ny klage',
    line: 24,
    outcome: 'expected',
    results: [
      createResult({
        duration: 96_400,
        steps: [
          createStep(['Fyll ut skjema'], 'test.step', 12_300),
          createStep(['Vent på saksbehandler'], 'test.step', 71_000),
        ],
        attachments: [
          {
            name: 'warningMessage',
            contentType: 'text/plain',
            body: Buffer.from('Backend svarte etter 71s. Forventet under 10s.'),
          },
        ],
      }),
    ],
  }),

  createTest(suite, {
    title: 'sender inn klagen',
    line: 42,
    outcome: 'unexpected',
    results: [0, 1, 2].map((retry) =>
      createResult({
        status: 'failed',
        duration: 18_700,
        retry,
        errors: [ASSERTION_ERROR],
        steps: [
          createStep(['Fyll ut skjema'], 'test.step', 8_200),
          createStep(['Send inn klage'], 'test.step', 9_400, ASSERTION_ERROR, [
            createStep(
              ['Send inn klage', "expect.toBeVisible(getByRole('heading'))"],
              'expect',
              5_000,
              ASSERTION_ERROR,
            ),
          ]),
        ],
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: nodePath.join(directory, 'screenshot.png') },
          { name: 'video', contentType: 'video/webm', path: nodePath.join(directory, 'video.webm') },
          { name: 'trace', contentType: 'application/zip', path: nodePath.join(directory, 'trace.zip') },
          { name: 'app state', contentType: 'application/json', body: Buffer.from('{ "draft": null }') },
        ],
        stdout: ['[browser] GET /api/klager 500 (Internal Server Error)\n'],
      }),
    ),
  }),

  createTest(suite, {
    title: 'viser kvittering',
    line: 61,
    outcome: 'flaky',
    results: [
      createResult({
        status: 'failed',
        duration: 9_100,
        retry: 0,
        errors: [ASSERTION_ERROR],
        steps: [createStep(['Åpne kvittering'], 'test.step', 8_900, ASSERTION_ERROR)],
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: nodePath.join(directory, 'screenshot.png') },
        ],
      }),
      createResult({ duration: 5_600, retry: 1, steps: [createStep(['Åpne kvittering'], 'test.step', 5_100)] }),
    ],
  }),

  createTest(suite, {
    title: 'sletter utkast',
    line: 75,
    outcome: 'skipped',
    results: [createResult({ status: 'skipped', duration: 0 })],
  }),

  createTest(suite, {
    title: 'laster ned PDF',
    line: 88,
    outcome: 'unexpected',
    results: [
      createResult({
        status: 'timedOut',
        duration: 60_000,
        errors: [TIMEOUT_ERROR],
        steps: [createStep(['Last ned PDF'], 'test.step', 59_000, TIMEOUT_ERROR)],
        // Playwright sometimes reports a trace that was never written to disk.
        attachments: [{ name: 'trace', contentType: 'application/zip', path: nodePath.join(directory, 'missing.zip') }],
      }),
    ],
  }),
];

/** A clean run: everything passes on the first attempt, and nothing is slow enough to be listed. */
export const createSuccessfulRun = (suite: Suite): TestCase[] => [
  createTest(suite, {
    title: 'logger inn som saksbehandler',
    line: 12,
    outcome: 'expected',
    results: [
      createResult({
        duration: 4_100,
        steps: [
          createStep(['Logg inn'], 'test.step', 3_700, undefined, [
            createStep(['Logg inn', 'page.goto'], 'pw:api', 1_000),
          ]),
        ],
      }),
    ],
  }),

  createTest(suite, {
    title: 'oppretter en ny klage',
    line: 24,
    outcome: 'expected',
    results: [
      createResult({
        duration: 11_800,
        steps: [createStep(['Fyll ut skjema'], 'test.step', 8_900), createStep(['Lagre utkast'], 'test.step', 2_400)],
      }),
    ],
  }),

  createTest(suite, {
    title: 'sender inn klagen',
    line: 42,
    outcome: 'expected',
    results: [
      createResult({
        duration: 14_300,
        steps: [createStep(['Send inn klage'], 'test.step', 9_600), createStep(['Vis kvittering'], 'test.step', 3_200)],
      }),
    ],
  }),

  createTest(suite, {
    title: 'laster ned PDF',
    line: 88,
    outcome: 'expected',
    results: [createResult({ duration: 6_700, steps: [createStep(['Last ned PDF'], 'test.step', 6_100)] })],
  }),
];
