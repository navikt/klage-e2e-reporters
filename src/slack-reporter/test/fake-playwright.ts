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
  outcome: ReturnType<TestCase['outcome']>;
  results: TestResult[];
}

export const createTest = (parent: Suite, { title, line, outcome, results }: TestOptions): TestCase => ({
  type: 'test',
  id: `fake-${line}`,
  title,
  parent,
  results,
  annotations: [],
  tags: [],
  expectedStatus: 'passed',
  repeatEachIndex: 0,
  retries: 2,
  timeout: 60_000,
  location: { file: nodePath.join(process.cwd(), FILE), line, column: 3 },
  titlePath: () => ['', PROJECT_NAME, FILE, 'Klage', title],
  outcome: () => outcome,
  ok: () => outcome !== 'unexpected',
});

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
