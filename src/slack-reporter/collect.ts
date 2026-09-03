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

/**
 * The media type without its parameters, lowercased. `attach()` takes the content type as free text, so
 * `text/plain; charset=utf-8` and `TEXT/PLAIN` name the same type as `text/plain` and must not be told apart.
 */
export const baseContentType = (contentType: string): string => contentType.split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * The warning text a test attached, which is read from the body and reported rather than uploaded. Attachment
 * names are free text, so one merely named `warningMessage` is an ordinary file: `collectUploads` skips exactly
 * what this accepts, so a file under that name is still uploaded instead of being lost by both.
 */
export const isWarningAttachment = ({ name, contentType, body }: TestResult['attachments'][number]): boolean =>
  name === 'warningMessage' && baseContentType(contentType) === 'text/plain' && body != null;

export const collectWarnings = (result: TestResult): string[] =>
  result.attachments.filter(isWarningAttachment).map(({ body }) => stripAnsi(body?.toString('utf-8') ?? ''));
