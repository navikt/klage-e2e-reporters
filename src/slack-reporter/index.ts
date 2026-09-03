import nodePath from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStatus,
  TestStep,
} from '@playwright/test/reporter';
import type { RichTextBlockElement } from '@slack/types';
import { asyncForEach, delay, formatDuration, getTestTitle, SlackIcon, truncate } from '@/functions';
import { createSlackClient, type SlackClientOptions, type SlackMessageThread } from '@/slack-client';
import {
  bulletList,
  chunkElements,
  code,
  italic,
  preformatted,
  richText,
  section,
  text,
  toBlocksFallbackText,
  toFallbackText,
} from '@/slack-reporter/blocks';
import { collectFailedSteps, collectSlowSteps, collectWarnings, currentStep } from '@/slack-reporter/collect';
import { MAIN_UPDATE_INTERVAL, MAX_MESSAGE_LENGTH, REPLY_INTERVAL } from '@/slack-reporter/constants';
import { formatError } from '@/slack-reporter/errors';
import { andMore, firstLine, heading, toStepItems } from '@/slack-reporter/format';
import { formatMainMessage, getHeadline, type MainMessage, type RunState } from '@/slack-reporter/main-message';
import { formatTestDetails } from '@/slack-reporter/test-details';
import type { Counts, TestReport } from '@/slack-reporter/types';
import { collectUploads } from '@/slack-reporter/uploads';

interface ActiveTest {
  title: string;
  startTime: number;
  /** The steps the test is inside, outermost first. */
  steps: TestStep[];
}

export interface SlackReporterOptions extends SlackClientOptions {
  /** Tests slower than this (ms) are listed as slow in the thread. @default 60_000 */
  slowTestThreshold?: number;
  /** Steps slower than this (ms) are listed as slow in the thread. @default 15_000 */
  slowStepThreshold?: number;
  /** Max entries in each slow list. @default 10 */
  maxSlowEntries?: number;
  /** Max failing tests that get their own detailed message in the thread. @default 25 */
  maxFailureDetails?: number;
}

/** Playwright never retries these, whatever the expected status was. */
const NEVER_RETRIED = new Set<TestStatus>(['skipped', 'interrupted']);

/** A failing attempt is followed by another until the test passes or the retry budget is spent. */
const willRetry = (test: TestCase, result: TestResult): boolean =>
  !NEVER_RETRIED.has(result.status) && result.status !== test.expectedStatus && result.retry < test.retries;

class SlackReporter implements Reporter {
  private slack: ReturnType<typeof createSlackClient> = null;
  private mainThread: SlackMessageThread | null = null;
  private reports: Map<string, TestReport> = new Map();
  /** Tests that will not run again, so one waiting for a retry does not count towards the progress. */
  private finished: Set<string> = new Set();
  /** Keyed by result, because a test and its retries each get their own. */
  private active: Map<TestResult, ActiveTest> = new Map();
  private globalErrors: TestError[] = [];
  private updateTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The update in flight, so the final message is never overtaken by an interim one. */
  private pendingUpdate: Promise<void> = Promise.resolve();
  private running = false;
  private totalTests = 0;
  private workers = 0;
  private startTime = Date.now();
  private slowTestThreshold: number;
  private slowStepThreshold: number;
  private maxSlowEntries: number;
  private maxFailureDetails: number;

  constructor(options: SlackReporterOptions) {
    this.slack = createSlackClient(options);
    this.slowTestThreshold = options.slowTestThreshold ?? 60_000;
    this.slowStepThreshold = options.slowStepThreshold ?? 15_000;
    this.maxSlowEntries = options.maxSlowEntries ?? 10;
    this.maxFailureDetails = options.maxFailureDetails ?? 25;
  }

  async onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    this.totalTests = suite.allTests().length;
    this.workers = config.workers;

    if (this.slack === null) {
      return;
    }

    const { blocks, color } = formatMainMessage(this.getRunState());

    this.mainThread = await this.slack.postMessage(toBlocksFallbackText(blocks), blocks, color);
    this.running = true;
    this.scheduleNextUpdate();
  }

  onError(error: TestError) {
    this.globalErrors.push(error);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    this.active.set(result, { title: getTestTitle(test), startTime: Date.now(), steps: [] });
  }

  onStepBegin(_test: TestCase, result: TestResult, step: TestStep) {
    const active = this.active.get(result);

    if (active !== undefined) {
      active.steps = [...active.steps, step];
    }
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep) {
    const active = this.active.get(result);

    if (active !== undefined) {
      active.steps = active.steps.filter((current) => current !== step);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.active.delete(result);
    this.reports.set(test.id, this.buildReport(test, result));

    if (!willRetry(test, result)) {
      this.finished.add(test.id);
    }
  }

  async onEnd(result: FullResult) {
    this.running = false;
    this.active.clear();

    // The run is over, so nothing is waiting for a retry any more.
    for (const { test } of this.reports.values()) {
      this.finished.add(test.id);
    }

    if (this.updateTimeout !== null) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    if (this.mainThread === null) {
      return;
    }

    try {
      await this.updateMainMessage(result);
    } catch (error) {
      console.error('Failed to update the main Slack message.', error);
    }

    await this.postSection('the errors outside of tests', () => this.postGlobalErrors());
    await this.postSection('the failure details', () => this.postFailureDetails());
    await this.postSection('the warnings', () => this.postWarnings());
    await this.postSection('the slow tests', () => this.postSlow());
  }

  /** A section that cannot be posted must not take the ones after it with it. */
  private async postSection(name: string, post: () => Promise<void>) {
    try {
      await post();
    } catch (error) {
      console.error(`Failed to post ${name} to Slack.`, error);
    }
  }

  /** The message shows elapsed time, so it is refreshed for as long as the run lasts. */
  private scheduleNextUpdate() {
    if (!this.running) {
      return;
    }

    this.updateTimeout = setTimeout(async () => {
      try {
        // Rendered when the update is sent, so it is skipped if the run finished while it was queued.
        await this.queueMainUpdate(() => (this.running ? formatMainMessage(this.getRunState()) : null));
      } catch {
        // The next tick tries again.
      }

      this.scheduleNextUpdate();
    }, MAIN_UPDATE_INTERVAL);
  }

  private async updateMainMessage(result: FullResult) {
    await this.queueMainUpdate(() => {
      const state = this.getRunState();

      return formatMainMessage(state, getHeadline(result, state));
    });
  }

  /** Serializes the updates, so an in-flight interim one can not land after the final one. */
  private queueMainUpdate(render: () => MainMessage | null): Promise<void> {
    this.pendingUpdate = this.pendingUpdate
      .catch(() => {
        // A failed update must not stop the ones after it.
      })
      .then(async () => {
        const message = render();

        if (this.mainThread === null || message === null) {
          return;
        }

        const { blocks, color } = message;

        this.mainThread = await this.mainThread.update(toBlocksFallbackText(blocks), blocks, color);
      });

    return this.pendingUpdate;
  }

  private async postGlobalErrors() {
    if (this.globalErrors.length === 0) {
      return;
    }

    const label = `${this.globalErrors.length} errors outside of tests`;
    const errors = truncate(this.globalErrors.map(formatError).join('\n\n'), MAX_MESSAGE_LENGTH - label.length - 100);

    await this.reply([heading(SlackIcon.FAILED, label), preformatted(errors)]);
  }

  /** One thread message per failing test, with its media attached to that message. */
  private async postFailureDetails() {
    const failing = [...this.getReports('unexpected'), ...this.getReports('flaky')];
    const reports = failing.slice(0, this.maxFailureDetails);

    if (failing.length > reports.length) {
      await this.reply([
        section([[italic(`Details for the first ${reports.length} of ${failing.length} failing tests:`)]]),
      ]);
    }

    await asyncForEach(reports, async (report) => {
      try {
        await this.postTestDetails(report);
      } catch (error) {
        console.error(`Failed to post failure details for "${report.title}".`, error);
      }

      await delay(REPLY_INTERVAL);
    });
  }

  private async postTestDetails(report: TestReport) {
    if (this.mainThread === null) {
      return;
    }

    const notes: string[] = [];
    const uploads = collectUploads(report, notes);
    const elements = formatTestDetails(report, uploads, notes);

    if (uploads.length === 0) {
      return await this.mainThread.reply(toFallbackText(elements), richText(elements));
    }

    try {
      await this.mainThread.replyFiles(uploads, toFallbackText(elements), richText(elements));
    } catch (error) {
      console.error(`Failed to upload ${uploads.length} attachments for "${report.title}".`, error);

      const failed = uploads.map(({ filename }) => filename).join(', ');
      const withNote = [...elements, section([[italic(`Failed to upload attachments: ${failed}`)]])];

      await this.mainThread.reply(toFallbackText(withNote), richText(withNote));
    }
  }

  private async postWarnings() {
    const warnings = [...this.reports.values()].flatMap(({ title, warnings }) =>
      warnings.map((warning) => ({ indent: 0, elements: [text(`${title} - `), italic(firstLine(warning))] })),
    );

    if (warnings.length === 0) {
      return;
    }

    await this.reply([heading(SlackIcon.WARNING, `Warnings (${warnings.length})`), ...bulletList(warnings)]);
  }

  private async postSlow() {
    const slow = [...this.reports.values()]
      .filter(({ duration, slowSteps }) => duration >= this.slowTestThreshold || slowSteps.length > 0)
      .sort((a, b) => b.duration - a.duration);

    if (slow.length === 0) {
      return;
    }

    const listed = slow.slice(0, this.maxSlowEntries);
    const thresholds = `tests over ${formatDuration(this.slowTestThreshold)}, steps over ${formatDuration(this.slowStepThreshold)}`;

    await this.reply([
      heading(SlackIcon.SLOW, `Slow (${slow.length})`, thresholds),
      ...bulletList(
        listed.flatMap(({ title, duration, slowSteps }) => [
          { indent: 0, elements: [text(`${title} `), code(formatDuration(duration))] },
          ...toStepItems(slowSteps, 1),
        ]),
      ),
      ...andMore(slow.length - listed.length, 'test'),
    ]);
  }

  private async reply(elements: RichTextBlockElement[]) {
    if (this.mainThread === null || elements.length === 0) {
      return;
    }

    for (const chunk of chunkElements(elements, MAX_MESSAGE_LENGTH)) {
      await this.mainThread.reply(toFallbackText(chunk), richText(chunk));
      await delay(REPLY_INTERVAL);
    }
  }

  private buildReport(test: TestCase, result: TestResult): TestReport {
    const previous = this.reports.get(test.id);
    const isFailure = result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted';
    const [, project] = test.titlePath();
    // A retry that is quicker than the attempt before it must not hide how slow the test can be.
    const slowest = previous !== undefined && previous.duration > result.duration ? previous : undefined;

    return {
      test,
      result,
      failedResult: isFailure ? result : previous?.failedResult,
      title: getTestTitle(test),
      project: project ?? 'unknown',
      location: `${nodePath.relative(process.cwd(), test.location.file)}:${test.location.line}`,
      duration: slowest?.duration ?? result.duration,
      attempts: result.retry + 1,
      failedSteps: isFailure ? collectFailedSteps(result.steps) : (previous?.failedSteps ?? []),
      // The slowest attempt is the telling one, and its duration and steps have to describe the same run.
      slowSteps: slowest?.slowSteps ?? collectSlowSteps(result.steps, this.slowStepThreshold),
      warnings: [...new Set([...(previous?.warnings ?? []), ...collectWarnings(result)])],
    };
  }

  private getRunState(): RunState {
    const now = Date.now();

    return {
      counts: this.getCounts(),
      done: this.finished.size,
      total: this.totalTests,
      workers: this.workers,
      elapsed: now - this.startTime,
      running: [...this.active.values()]
        .map(({ title, startTime, steps }) => ({ title, step: currentStep(steps), elapsed: now - startTime }))
        .sort((a, b) => b.elapsed - a.elapsed),
    };
  }

  private getReports(outcome: ReturnType<TestCase['outcome']>) {
    return [...this.reports.values()].filter(({ test }) => test.outcome() === outcome);
  }

  private getCounts(): Counts {
    const counts: Counts = { passed: 0, flaky: 0, failed: 0, skipped: 0 };

    for (const { test } of this.reports.values()) {
      if (!this.finished.has(test.id)) {
        continue;
      }

      switch (test.outcome()) {
        case 'expected':
          counts.passed++;
          break;
        case 'flaky':
          counts.flaky++;
          break;
        case 'unexpected':
          counts.failed++;
          break;
        case 'skipped':
          counts.skipped++;
          break;
      }
    }

    return counts;
  }
}

export default SlackReporter;
