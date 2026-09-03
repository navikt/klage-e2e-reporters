import { describe, expect, test } from 'bun:test';
import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import type { ChatPostMessageResponse } from '@slack/web-api';
import { delay } from '@/functions';
import { type SlackFileUpload, SlackMessageThread } from '@/slack-client';
import SlackReporter from '@/slack-reporter';
import { Pace } from '@/slack-reporter/pace';
import { BOT_NAME, TRIGGER } from '@/slack-reporter/test/constants';
import { createConfig, createResult, createSuite, createTest } from '@/slack-reporter/test/fake-playwright';

const MESSAGE: ChatPostMessageResponse = { ok: true, ts: '1700000000.000100', channel: 'C0123456789' };

/**
 * A Slack client that records what the reporter posts. The reporter reaches it through the real
 * `SlackMessageThread`, so the wiring under test is the one that runs in a real report.
 */
class RecordingSlack {
  readonly replies: string[] = [];
  readonly rewrites: string[] = [];
  /** The filenames of each upload, so a rewrite can be told from a message posted anew. */
  readonly uploads: string[][] = [];

  async postMessage() {
    return this.thread();
  }

  async updateMessage() {
    return this.thread();
  }

  async rewriteMessage(_message: unknown, rewritten: string) {
    this.rewrites.push(rewritten);

    return this.thread();
  }

  async postReply(_message: unknown, reply: string) {
    this.replies.push(reply);

    return this.thread();
  }

  async uploadFiles(files: SlackFileUpload[], message?: string) {
    this.replies.push(message ?? '');
    this.uploads.push(files.map(({ filename }) => filename));

    return this.thread();
  }

  private thread = () => new SlackMessageThread(this as never, MESSAGE);
}

const FAILED = { status: 'failed' as const, duration: 1_000, errors: [{ message: 'Expected: visible' }] };

const started = async (slack: RecordingSlack, suite: Suite) => {
  // A pace that never waits: the intervals are Slack's, and `Pace` is tested on its own.
  const reporter = new SlackReporter(
    { botName: BOT_NAME, trigger: TRIGGER },
    { slack: slack as never, pace: new Pace(0) },
  );

  await reporter.onBegin(createConfig(), suite);

  return reporter;
};

/** Plays one attempt of a test, and lets whatever it queued be posted. */
const attempt = async (reporter: SlackReporter, test: TestCase, result: TestResult) => {
  test.results.push(result);

  reporter.onTestBegin(test, result);
  reporter.onTestEnd(test, result);

  await delay(0);
};

const END: FullResult = { status: 'failed', startTime: new Date(), duration: 1_000 };

describe('SlackReporter', () => {
  test('posts the details of a failing test while the run is still going', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const failing = createTest(suite, { title: 'fails', line: 12, retries: 0, results: [] });
    const other = createTest(suite, { title: 'still running', line: 24, retries: 0, results: [] });

    suite.tests.push(failing, other);

    const reporter = await started(slack, suite);

    reporter.onTestBegin(other, createResult({ duration: 1_000 }));
    await attempt(reporter, failing, createResult(FAILED));

    // Before `onEnd`, and with a test still on its way.
    expect(slack.replies).toEqual([expect.stringContaining('Failed: Klage > fails')]);
  });

  test('posts a failing attempt that is still waiting for its retry', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const failing = createTest(suite, { title: 'fails', line: 12, results: [] });

    suite.tests.push(failing);

    const reporter = await started(slack, suite);

    // Two retries are still to come, and a retry rarely fails the same way twice.
    await attempt(reporter, failing, createResult({ ...FAILED, retry: 0 }));

    expect(slack.replies).toEqual([expect.stringContaining('Failed: Klage > fails')]);
  });

  test('posts every failing attempt, each with its own media', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const failing = createTest(suite, { title: 'fails', line: 12, results: [] });

    suite.tests.push(failing);

    const reporter = await started(slack, suite);

    for (const retry of [0, 1, 2]) {
      await attempt(reporter, failing, createResult({ ...FAILED, retry }));
    }

    expect(slack.replies).toEqual([
      expect.stringContaining('Failed: Klage > fails'),
      expect.stringContaining('attempt 2'),
      expect.stringContaining('attempt 3'),
    ]);
    expect(slack.uploads).toEqual([['error.txt'], ['error.txt'], ['error.txt']]);
  });

  test('rewrites the details it already posted when a retry turns the failure into a flake', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const flaky = createTest(suite, { title: 'flakes', line: 12, results: [] });

    suite.tests.push(flaky);

    const reporter = await started(slack, suite);

    await attempt(reporter, flaky, createResult({ ...FAILED, retry: 0 }));
    await attempt(reporter, flaky, createResult({ ...FAILED, retry: 1 }));

    expect(slack.replies).toHaveLength(2);
    expect(slack.rewrites).toEqual([]);

    await attempt(reporter, flaky, createResult({ duration: 1_000, retry: 2 }));

    // The attempt that passed says nothing of its own, and the two that failed now say what they turned out to be.
    expect(slack.replies).toHaveLength(2);
    expect(slack.rewrites).toEqual([
      expect.stringContaining('Flaky: Klage > flakes'),
      expect.stringContaining('Flaky: Klage > flakes'),
    ]);

    // Rewritten rather than posted again, so each message keeps its own attempt, its errors and its files.
    expect(slack.rewrites[1]).toContain('attempt 2');
    expect(slack.rewrites[1]).toContain('Expected: visible');
    expect(slack.uploads).toEqual([['error.txt'], ['error.txt']]);
  });

  test('says nothing about a test that failed the way it said it would', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const expected = createTest(suite, {
      title: 'fails on purpose',
      line: 12,
      retries: 0,
      expectedStatus: 'failed',
      results: [],
    });

    suite.tests.push(expected);

    const reporter = await started(slack, suite);

    await attempt(reporter, expected, createResult(FAILED));
    await reporter.onEnd({ ...END, status: 'passed' });

    expect(slack.replies).toEqual([]);
  });

  test('holds the details to the limit, and says what was left out once the run is over', async () => {
    const slack = new RecordingSlack();
    const suite = createSuite();
    const failing = createTest(suite, { title: 'fails', line: 12, results: [] });

    suite.tests.push(failing);

    const reporter = new SlackReporter(
      { botName: BOT_NAME, trigger: TRIGGER, maxFailureDetails: 1 },
      { slack: slack as never, pace: new Pace(0) },
    );

    await reporter.onBegin(createConfig(), suite);

    for (const retry of [0, 1, 2]) {
      await attempt(reporter, failing, createResult({ ...FAILED, retry }));
    }

    expect(slack.replies).toEqual([expect.stringContaining('Failed: Klage > fails')]);

    await reporter.onEnd(END);

    expect(slack.replies).toEqual([
      expect.stringContaining('Failed: Klage > fails'),
      expect.stringContaining('Details for the first 1 of 3 failed attempts. 2 are left out.'),
    ]);
  });
});
