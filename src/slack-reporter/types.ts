import type { TestCase, TestResult } from '@playwright/test/reporter';

export interface StepReport {
  title: string;
  duration: number;
  steps: StepReport[];
}

export interface TestReport {
  test: TestCase;
  /** The last result, which decides the outcome. */
  result: TestResult;
  /** The last failing attempt. Holds the error and the media of a failed or flaky test. */
  failedResult: TestResult | undefined;
  title: string;
  project: string;
  location: string;
  duration: number;
  attempts: number;
  failedSteps: StepReport[];
  slowSteps: StepReport[];
  warnings: string[];
}

export interface RunningTest {
  title: string;
  /** The step it is on, if it is inside one. */
  step: string | undefined;
  elapsed: number;
}

export interface Counts {
  passed: number;
  flaky: number;
  failed: number;
  skipped: number;
}
