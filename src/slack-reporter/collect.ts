import type { TestResult, TestStep } from '@playwright/test/reporter';
import { stripAnsi } from '@/functions';
import { firstLine } from '@/slack-reporter/format';
import type { StepReport } from '@/slack-reporter/types';

const SETUP_CATEGORIES = new Set(['hook', 'fixture']);

/** The step shown for a running test. Prefers the innermost `test.step`, the ones the test author named. */
export const currentStep = (steps: TestStep[]): string | undefined => {
  const visible = steps.filter(({ category }) => !SETUP_CATEGORIES.has(category));
  const step = visible.findLast(({ category }) => category === 'test.step') ?? visible.at(-1);

  return step === undefined ? undefined : firstLine(step.title);
};

/** The failing branch of the step tree, nesting kept. */
export const collectFailedSteps = (steps: TestStep[]): StepReport[] =>
  steps.flatMap((step) => {
    if (step.error === undefined || step.category === 'fixture') {
      return [];
    }

    return [{ title: firstLine(step.title), duration: step.duration, steps: collectFailedSteps(step.steps) }];
  });

/** The slow steps, slow children kept nested under their slow parent. */
export const collectSlowSteps = (steps: TestStep[], threshold: number): StepReport[] =>
  steps.flatMap((step) => {
    const nested = collectSlowSteps(step.steps, threshold);

    if (step.category !== 'test.step' || step.duration < threshold) {
      return nested;
    }

    return [{ title: firstLine(step.title), duration: step.duration, steps: nested }];
  });

export const collectWarnings = (result: TestResult): string[] =>
  result.attachments
    .filter(({ name, contentType, body }) => name === 'warningMessage' && contentType === 'text/plain' && body != null)
    .map(({ body }) => stripAnsi(body?.toString('utf-8') ?? ''));
