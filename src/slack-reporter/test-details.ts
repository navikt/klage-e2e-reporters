import type { RichTextBlockElement, RichTextElement } from '@slack/types';
import { formatDuration, getTestStatusIcon, truncate } from '@/functions';
import type { SlackFileUpload } from '@/slack-client';
import {
  bold,
  bulletList,
  code,
  icon,
  italic,
  preformatted,
  section,
  text,
  toFallbackText,
} from '@/slack-reporter/blocks';
import { MAX_DETAILED_STEPS, MAX_MESSAGE_LENGTH } from '@/slack-reporter/constants';
import { errorMessage } from '@/slack-reporter/errors';
import { limitItems, toStepItems } from '@/slack-reporter/format';
import type { TestReport } from '@/slack-reporter/types';

/** The thread message for a single failing test, posted together with its media. */
export const formatTestDetails = (
  report: TestReport,
  uploads: SlackFileUpload[],
  notes: string[],
): RichTextBlockElement[] => {
  const { test, result, failedResult, title, project, location, attempts, failedSteps } = report;
  const outcome = test.outcome() === 'flaky' ? 'Flaky' : 'Failed';
  const { status, duration } = failedResult ?? result;

  const elements: RichTextBlockElement[] = [
    section([
      [icon(getTestStatusIcon(test, result.status)), bold(` ${outcome}: ${title}`)],
      [
        code(project),
        text(' · '),
        code(location),
        text(' · '),
        code(formatDuration(duration)),
        ...(attempts > 1 ? [text(` · ${attempts} attempts`)] : []),
        text(' · '),
        code(status),
      ],
    ]),
  ];

  if (failedSteps.length > 0) {
    elements.push(section([[bold('Failed steps')]]));
    elements.push(...bulletList(limitItems(toStepItems(failedSteps, 0), MAX_DETAILED_STEPS)));
  }

  const trace = uploads.find(({ filename }) => filename.startsWith('trace'));
  const trailer: RichTextElement[][] = [
    ...(trace === undefined
      ? []
      : [[italic('View the trace with '), code(`npx playwright show-trace ${trace.filename}`)]]),
    ...notes.map((note) => [italic(note)]),
  ];

  if (trailer.length > 0) {
    elements.push(section(trailer));
  }

  const errors = (failedResult ?? result).errors;

  if (errors.length === 0) {
    return elements;
  }

  const messages = errors
    .map((error, index) => {
      const prefix = errors.length > 1 ? `Error ${index + 1} of ${errors.length}:\n` : '';

      return `${prefix}${errorMessage(error)}`;
    })
    .join('\n\n');

  // Truncating is safe: the full errors are always attached as `error.txt`. A message whose steps and notes
  // have already spent the budget gets none of them, rather than one that pushes it over the limit.
  const budget = MAX_MESSAGE_LENGTH - toFallbackText(elements).length - 100;

  if (budget <= 0) {
    return elements;
  }

  return [...elements, preformatted(truncate(messages, budget))];
};
