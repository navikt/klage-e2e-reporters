import nodePath from 'node:path';
import type { FullConfig, Suite, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';
import { PROJECT_NAME } from '@/slack-reporter/test/constants';

/** Fake Playwright objects, with only the parts the reporter reads. */

export const FILE = 'tests/klage.spec.ts';

export const createConfig = () => ({ projects: [{ name: PROJECT_NAME }], workers: 4 }) as unknown as FullConfig;

export const createSuite = (): Suite => {
  const suite: Suite = {
    type: 'root',
    title: '',
    suites: [],
    tests: [],
    titlePath: () => [],
    allTests: () => suite.tests,
    entries: () => suite.tests,
    project: () => undefined,
  };

  return suite;
};

interface TestOptions {
  title: string;
  line: number;
  results: TestResult[];
  /** How many times Playwright would run it again after a failure. @default 2 */
  retries?: number;
  /** What the test says it should do, which `test.fail()` turns around. @default 'passed' */
  expectedStatus?: TestCase['expectedStatus'];
}

export const createTest = (
  parent: Suite,
  { title, line, results, retries = 2, expectedStatus = 'passed' }: TestOptions,
): TestCase => {
  const test: TestCase = {
    type: 'test',
    id: `fake-${line}`,
    title,
    parent,
    results,
    annotations: [],
    tags: [],
    expectedStatus,
    repeatEachIndex: 0,
    retries,
    timeout: 60_000,
    location: { file: nodePath.join(process.cwd(), FILE), line, column: 3 },
    titlePath: () => ['', PROJECT_NAME, FILE, 'Klage', title],
    outcome: () => outcomeOf(test),
    ok: () => outcomeOf(test) !== 'unexpected',
  };

  return test;
};

/**
 * The outcome of the attempts recorded so far, the way Playwright works it out: a skipped or interrupted
 * attempt says nothing, and a test that both failed and passed is flaky. Derived rather than declared, so a
 * test played one attempt at a time reads as `unexpected` until the retry that saves it has run, and the
 * reporter cannot be shown an outcome the run has not reached yet.
 */
const outcomeOf = ({ results, expectedStatus }: TestCase): ReturnType<TestCase['outcome']> => {
  const counted = results.filter(({ status }) => status !== 'skipped' && status !== 'interrupted');
  const expected = counted.filter(({ status }) => status === expectedStatus).length;
  const unexpected = counted.length - expected;

  if (counted.length === 0) {
    return 'skipped';
  }

  if (unexpected === 0) {
    return 'expected';
  }

  return expected === 0 ? 'unexpected' : 'flaky';
};

/**
 * Takes the attempts off a fake test, for a run that plays them back one at a time. Playwright records an
 * attempt when it begins, so a run that hands them all over up front would let the reporter see the end of a
 * test before it has run.
 */
export const takeResults = (test: TestCase): TestResult[] => test.results.splice(0, test.results.length);

interface ResultOptions {
  status?: TestResult['status'];
  duration: number;
  retry?: number;
  errors?: TestError[];
  steps?: TestStep[];
  attachments?: TestResult['attachments'];
  stdout?: string[];
}

export const createResult = ({
  status = 'passed',
  duration,
  retry = 0,
  errors = [],
  steps = [],
  attachments = [],
  stdout = [],
}: ResultOptions): TestResult => ({
  status,
  duration,
  retry,
  errors,
  error: errors[0],
  steps,
  attachments,
  stdout,
  stderr: [],
  annotations: [],
  startTime: new Date(),
  workerIndex: 0,
  parallelIndex: 0,
});

export const createStep = (
  titlePath: string[],
  category: string,
  duration: number,
  error?: TestError,
  steps: TestStep[] = [],
): TestStep => ({
  title: titlePath.at(-1) ?? '',
  titlePath: () => titlePath,
  category,
  duration,
  error,
  steps,
  attachments: [],
  annotations: [],
  startTime: new Date(),
  location: { file: nodePath.join(process.cwd(), FILE), line: 42, column: 5 },
});
