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
import { formatDuration, getTestTitle, SlackIcon, truncate } from '@/functions';
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
import { MAIN_UPDATE_INTERVAL, MAX_MESSAGE_LENGTH } from '@/slack-reporter/constants';
import { formatError } from '@/slack-reporter/errors';
import { andMore, firstLine, heading, toStepItems } from '@/slack-reporter/format';
import { formatMainMessage, getHeadline, type MainMessage, type RunState } from '@/slack-reporter/main-message';
import { Pace } from '@/slack-reporter/pace';
import { ReplyQueue } from '@/slack-reporter/queue';
import { formatTestDetails } from '@/slack-reporter/test-details';
import { getTrigger, type Trigger, warnAboutMissingTrigger } from '@/slack-reporter/trigger';
import type { Counts, TestReport } from '@/slack-reporter/types';
import { collectUploads, findTrace } from '@/slack-reporter/uploads';

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
  /** Max slow tests listed in the thread, each with all of its slow steps. @default 10 */
  maxSlowTests?: number;
  /** Max failing attempts that get their own detailed message in the thread, the first to fail. @default 25 */
  maxFailureDetails?: number;
  /** Run metadata shown below the main message. Read from the GitHub Actions environment by default. */
  trigger?: Partial<Trigger>;
}

/**
 * Playwright never retries these, whatever the expected status was, and neither is a failure of the test's own
 * making: one was never run, and the other was cut short along with the run.
 */
const NEVER_RETRIED = new Set<TestStatus>(['skipped', 'interrupted']);

/** What the reporter would otherwise build for itself. Playwright passes the options alone; the tests do not. */
interface Internals {
  slack?: ReturnType<typeof createSlackClient>;
  pace?: Pace;
}

/** An attempt that did not do what the test expected of it, and so has something to report. */
const isFailedAttempt = (test: TestCase, result: TestResult): boolean =>
  !NEVER_RETRIED.has(result.status) && result.status !== test.expectedStatus;

/** A failing attempt is followed by another until the test passes or the retry budget is spent. */
const willRetry = (test: TestCase, result: TestResult): boolean =>
  isFailedAttempt(test, result) && result.retry < test.retries;

/**
 * A detailed message that is already in the thread, and what it was made of. A test that fails and then passes
 * is flaky rather than failed, and the same report renders as such, so the message can be rewritten to say so
 * instead of being left behind saying the run failed.
 */
interface PostedDetails {
  message: SlackMessageThread;
  report: TestReport;
  trace: string | undefined;
  notes: string[];
}

class SlackReporter implements Reporter {
  private slack: ReturnType<typeof createSlackClient> = null;
  private mainThread: SlackMessageThread | null = null;
  private reports: Map<string, TestReport> = new Map();
  /** Tests that will not run again, so one waiting for a retry does not count towards the progress. */
  private finished: Set<string> = new Set();
  /** Keyed by result, because a test and its retries each get their own. */
  private active: Map<TestResult, ActiveTest> = new Map();
  private globalErrors: TestError[] = [];
  /** The thread replies, posted one at a time while the run is going. */
  private replies = new ReplyQueue();
  /** Slack holds the whole thread to about one message per second, replies and their uploads alike. */
  private pace: Pace;
  /** The details already in the thread, by test, so a test that turns out flaky can have them rewritten. */
  private posted: Map<string, PostedDetails[]> = new Map();
  private postedDetails = 0;
  /** Failing attempts left without details of their own, counted while the run was still going. */
  private omittedDetails = 0;
  private updateTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The update in flight, so the final message is never overtaken by an interim one. */
  private pendingUpdate: Promise<void> = Promise.resolve();
  private running = false;
  private totalTests = 0;
  private workers = 0;
  private startTime = Date.now();
  private slowTestThreshold: number;
  private slowStepThreshold: number;
  private maxSlowTests: number;
  private maxFailureDetails: number;
  private trigger: Trigger;

  constructor(options: SlackReporterOptions, internals: Internals = {}) {
    this.slack = internals.slack === undefined ? createSlackClient(options) : internals.slack;
    this.pace = internals.pace ?? new Pace();
    this.slowTestThreshold = options.slowTestThreshold ?? 60_000;
    this.slowStepThreshold = options.slowStepThreshold ?? 15_000;
    this.maxSlowTests = options.maxSlowTests ?? 10;
    this.maxFailureDetails = options.maxFailureDetails ?? 25;
    this.trigger = getTrigger(options.trigger);

    // Only worth saying when a report is actually going to Slack: without a client there is nothing to be wrong.
    if (this.slack !== null) {
      warnAboutMissingTrigger(this.trigger);
    }
  }

  async onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    this.totalTests = suite.allTests().length;
    this.workers = config.workers;

    if (this.slack === null) {
      return;
    }

    const { blocks, color } = formatMainMessage(this.getRunState(), this.trigger);

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
    this.reports.set(test.id, this.buildReport(test, result, this.reports.get(test.id)));

    // Every failing attempt gets its own message: a retry rarely fails the same way twice, and the attempt that
    // was thrown away is often the one that says why.
    if (isFailedAttempt(test, result)) {
      this.queueTestDetails(this.buildReport(test, result));
    }

    if (willRetry(test, result)) {
      return;
    }

    this.finished.add(test.id);

    // The retry saved it, so what is already in the thread is about a flaky test rather than a failed one.
    if (test.outcome() === 'flaky') {
      this.queueRelabel(test);
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

    // The details of the last tests to fail are still on their way, and the closing sections belong after them.
    await this.replies.drain();

    this.replies.add('the omitted failure details', () => this.postOmittedDetails());
    this.replies.add('the errors outside of tests', () => this.postGlobalErrors());
    this.replies.add('the warnings', () => this.postWarnings());
    this.replies.add('the slow tests', () => this.postSlow());

    await this.replies.drain();
  }

  /** The message shows elapsed time, so it is refreshed for as long as the run lasts. */
  private scheduleNextUpdate() {
    if (!this.running) {
      return;
    }

    this.updateTimeout = setTimeout(async () => {
      try {
        // Rendered when the update is sent, so it is skipped if the run finished while it was queued.
        await this.queueMainUpdate(() => (this.running ? formatMainMessage(this.getRunState(), this.trigger) : null));
      } catch {
        // The next tick tries again.
      }

      this.scheduleNextUpdate();
    }, MAIN_UPDATE_INTERVAL);
  }

  private async updateMainMessage(result: FullResult) {
    await this.queueMainUpdate(() => {
      const state = this.getRunState();

      return formatMainMessage(state, this.trigger, getHeadline(result, state));
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

  /** One thread message per failing attempt, with the media of that attempt attached to it. */
  private queueTestDetails(report: TestReport) {
    if (this.mainThread === null) {
      return;
    }

    // How many attempts fail in the end is unknown while the run is going, so what is left out is counted here
    // and reported once the run is over.
    if (this.postedDetails >= this.maxFailureDetails) {
      this.omittedDetails++;

      return;
    }

    this.postedDetails++;
    this.replies.add(`the failure details for "${firstLine(report.title)}"`, () => this.postTestDetails(report));
  }

  /** Rewrites the details already in the thread, now that the test they are about turned out to be flaky. */
  private queueRelabel(test: TestCase) {
    // Queued behind the details themselves, and read when it runs rather than now: the messages it rewrites are
    // often still on their way up when the retry that saves the test comes in.
    this.replies.add(`the flaky outcome of "${firstLine(getTestTitle(test))}"`, async () => {
      const posted = this.posted.get(test.id) ?? [];

      this.posted.delete(test.id);

      for (const { message, report, trace, notes } of posted) {
        // Rendered again rather than patched: the outcome is read from the test, which now says flaky, and the
        // rest of the message is built from the same attempt as the first time.
        const elements = formatTestDetails(report, trace, notes);

        // A rewrite keeps the files already on the message, so the attempt keeps its media.
        await message.rewrite(toFallbackText(elements), richText(elements));
      }
    });
  }

  /** The failing attempts the limit left without details, named once the run has been through all of them. */
  private async postOmittedDetails() {
    if (this.omittedDetails === 0) {
      return;
    }

    const failing = this.postedDetails + this.omittedDetails;
    const note = `Details for the first ${this.postedDetails} of ${failing} failed attempts. ${this.omittedDetails} are left out.`;

    await this.reply([section([[italic(note)]])]);
  }

  private async postTestDetails(report: TestReport) {
    if (this.mainThread === null) {
      return;
    }

    const notes: string[] = [];
    const uploads = collectUploads(report, notes);
    const trace = findTrace(uploads)?.filename;
    const elements = formatTestDetails(report, trace, notes);

    await this.pace.next();

    if (uploads.length === 0) {
      this.remember(report, await this.mainThread.reply(toFallbackText(elements), richText(elements)), trace, notes);

      return;
    }

    try {
      const message = await this.mainThread.replyFiles(uploads, toFallbackText(elements), richText(elements));

      this.remember(report, message, trace, notes);
    } catch (error) {
      console.error(`Failed to upload ${uploads.length} attachments for "${report.title}".`, error);

      const failed = uploads.map(({ filename }) => filename).join(', ');
      // Formatted again without the uploads: the note has to be inside the message budget rather than appended
      // to one that already spent it, and the trace command would point at a file that never made it.
      const withNote = [...notes, `Failed to upload attachments: ${failed}`];
      const elementsWithNote = formatTestDetails(report, undefined, withNote);

      await this.pace.next();

      const message = await this.mainThread.reply(toFallbackText(elementsWithNote), richText(elementsWithNote));

      this.remember(report, message, undefined, withNote);
    }
  }

  /** Held on to so the message can be rewritten if the test turns out flaky. The limit bounds how many. */
  private remember(report: TestReport, message: SlackMessageThread, trace: string | undefined, notes: string[]) {
    const { id } = report.test;

    this.posted.set(id, [...(this.posted.get(id) ?? []), { message, report, trace, notes }]);
  }

  private async postWarnings() {
    const warnings = [...this.reports.values()].flatMap(({ title, warnings }) =>
      warnings.map((warning) => ({
        indent: 0,
        elements: [text(`${firstLine(title)} - `), italic(firstLine(warning))],
      })),
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

    const listed = slow.slice(0, this.maxSlowTests);
    const thresholds = `tests over ${formatDuration(this.slowTestThreshold)}, steps over ${formatDuration(this.slowStepThreshold)}`;

    await this.reply([
      heading(SlackIcon.SLOW, `Slow (${slow.length})`, thresholds),
      ...bulletList(
        listed.flatMap(({ title, duration, slowSteps }) => [
          { indent: 0, elements: [text(`${firstLine(title)} `), code(formatDuration(duration))] },
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
      await this.pace.next();
      await this.mainThread.reply(toFallbackText(chunk), richText(chunk));
    }
  }

  private buildReport(test: TestCase, result: TestResult, previous?: TestReport): TestReport {
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
