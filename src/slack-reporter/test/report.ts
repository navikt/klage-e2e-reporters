/**
 * Posts fake test runs to Slack, so the layout of the report can be verified by hand. A manual check, not a
 * unit test, so it is run on demand and never as a part of `bun test`.
 *
 * ```sh
 * bun run report:slack
 * ```
 *
 * Bun reads the Slack credentials from `.env`:
 *
 * ```sh
 * slack_e2e_token=xoxb-...
 * slack_signing_secret=...
 * klage_notifications_channel=C0123456789
 * ```
 */
import fs from 'node:fs';
import os from 'node:os';
import type { FullResult, Suite, TestCase } from '@playwright/test/reporter';
import { asyncForEach, delay } from '@/functions';
import { BOT_NAME, REPOSITORY } from '@/slack-reporter/test/constants';
import { createConfig, createSuite } from '@/slack-reporter/test/fake-playwright';
import { createAttachments, createFailedRun, createSuccessfulRun } from '@/slack-reporter/test/fake-runs';

const REQUIRED_ENV_VARS = ['slack_e2e_token', 'slack_signing_secret', 'klage_notifications_channel'];

const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => (process.env[name] ?? '').length === 0);

if (missingEnvVars.length > 0) {
  console.error(`Missing env variables: ${missingEnvVars.join(', ')}. Bun reads them from .env.`);
  process.exit(1);
}

// The reporter reads the trigger metadata on import, so it has to be set before importing it.
process.env.VERSION ??= 'fake-version';
process.env.GITHUB_ACTOR ??= os.userInfo().username;
process.env.GITHUB_REPOSITORY ??= REPOSITORY;
process.env.GITHUB_REF_NAME ??= 'fake-branch';

const { default: SlackReporter } = await import('@/slack-reporter');

const main = async () => {
  const directory = createAttachments();

  try {
    console.info('Reporting a failed test run to Slack.');
    await reportFakeRun((suite) => createFailedRun(suite, directory), 'failed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.info('Reporting a successful test run to Slack.');
  await reportFakeRun(createSuccessfulRun, 'passed');

  console.info('Done. Run `bun run clean:slack` to delete the reports again.');
};

/** Runs the reporter through a complete fake run, and fails if it logs anything to `console.error`. */
const reportFakeRun = async (create: (suite: Suite) => TestCase[], status: FullResult['status']) => {
  const { errorCount, restore } = countErrors();

  try {
    const reporter = new SlackReporter({
      botName: BOT_NAME,
      slowTestThreshold: 30_000,
      slowStepThreshold: 10_000,
    });

    const suite = createSuite();
    const tests = create(suite);

    suite.tests.push(...tests);

    await reporter.onBegin(createConfig(), suite);

    await playRun(reporter, tests);

    await reporter.onEnd({ status, startTime: new Date(), duration: 138_000 });
  } finally {
    restore();
  }

  if (errorCount() > 0) {
    console.error(`The reporter logged ${errorCount()} errors while reporting the ${status} run.`);
    process.exit(1);
  }
};

/** Counts what the reporter logs to `console.error`, while still showing it. */
const countErrors = () => {
  const original = console.error;
  let count = 0;

  console.error = (...args: unknown[]) => {
    count++;
    original(...args);
  };

  return {
    errorCount: () => count,
    restore: () => {
      console.error = original;
    },
  };
};

/** Long enough that the main message is updated a few times while the run is in progress. */
const STEP_DURATION = 1_000;

const WORKERS = 2;

/** Plays the tests the way Playwright would: a few workers, each running its tests one step at a time. */
const playRun = async (reporter: InstanceType<typeof SlackReporter>, tests: TestCase[]) => {
  const lanes = Array.from({ length: WORKERS }, (_, worker) =>
    tests.filter((_test, index) => index % WORKERS === worker),
  );

  await Promise.all(lanes.map((lane) => asyncForEach(lane, (testCase) => playTest(reporter, testCase))));
};

const playTest = async (reporter: InstanceType<typeof SlackReporter>, testCase: TestCase) => {
  for (const result of testCase.results) {
    reporter.onTestBegin(testCase, result);

    await asyncForEach(result.steps, async (step) => {
      reporter.onStepBegin(testCase, result, step);

      for (const nested of step.steps) {
        reporter.onStepBegin(testCase, result, nested);
        reporter.onStepEnd(testCase, result, nested);
      }

      await delay(STEP_DURATION);

      reporter.onStepEnd(testCase, result, step);
    });

    reporter.onTestEnd(testCase, result);
  }
};

await main();
