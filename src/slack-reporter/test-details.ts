import type { RichTextBlockElement, RichTextElement } from '@slack/types';
import { formatDuration, getTestStatusIcon, shorten, truncate } from '@/functions';
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
import { inlineToText } from '@/slack-reporter/blocks/fallback';
import { MAX_DETAILED_STEPS, MAX_FIELD_LENGTH, MAX_MESSAGE_LENGTH, MIN_ERROR_LENGTH } from '@/slack-reporter/constants';
import { errorMessage } from '@/slack-reporter/errors';
import { firstLine, limitItems, toStepItems } from '@/slack-reporter/format';
import type { TestReport } from '@/slack-reporter/types';
import { findTrace } from '@/slack-reporter/uploads';

/**
 * The thread message for a single failing test, posted together with its media.
 *
 * This one is posted as it is, rather than through `chunkElements`, so that it stays with its attachments. Test
 * titles, step titles, project names, paths and notes are all free text, so every part is fitted to the message
 * budget here: the heading first, then the failed steps, the trailer, and finally the errors with whatever is
 * left.
 */
export const formatTestDetails = (
  report: TestReport,
  uploads: SlackFileUpload[],
  notes: string[],
): RichTextBlockElement[] => {
  const { test, result, failedResult, title, project, location, attempts, failedSteps } = report;
  const outcome = test.outcome() === 'flaky' ? 'Flaky' : 'Failed';
  const { status, duration } = failedResult ?? result;

  const elements: RichTextBlockElement[] = [];
  let remaining = MAX_MESSAGE_LENGTH;

  const push = (...added: RichTextBlockElement[]) => {
    elements.push(...added);
    remaining -= size(added);
  };

  push(
    section([
      [icon(getTestStatusIcon(test, result.status)), bold(` ${outcome}: ${firstLine(title)}`)],
      [
        code(shorten(project, MAX_FIELD_LENGTH)),
        text(' · '),
        code(shorten(location, MAX_FIELD_LENGTH)),
        text(' · '),
        code(formatDuration(duration)),
        ...(attempts > 1 ? [text(` · ${attempts} attempts`)] : []),
        text(' · '),
        code(status),
      ],
    ]),
  );

  if (failedSteps.length > 0) {
    const label = section([[bold('Failed steps')]]);
    const items = limitItems(toStepItems(failedSteps, 0), MAX_DETAILED_STEPS, remaining - size([label]));

    if (items.length > 0) {
      push(label, ...bulletList(items));
    }
  }

  const trace = findTrace(uploads);
  const trailer = fitLines(
    [
      ...(trace === undefined
        ? []
        : [[italic('View the trace with '), code(`npx playwright show-trace ${trace.filename}`)]]),
      ...notes.map((note) => [italic(firstLine(note))]),
    ],
    remaining,
  );

  if (trailer.length > 0) {
    push(section(trailer));
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
  const budget = remaining - 1;

  if (budget < MIN_ERROR_LENGTH) {
    return elements;
  }

  return [...elements, preformatted(truncate(messages, budget))];
};

/** What appending the elements to a message costs: their own length, plus the line break before them. */
const size = (elements: RichTextBlockElement[]) => toFallbackText(elements).length + 1;

/** The lines of a section that fit the budget, in order. A line is kept whole or left out. */
const fitLines = (lines: RichTextElement[][], budget: number): RichTextElement[][] => {
  const kept: RichTextElement[][] = [];
  // Each line costs its own text plus a break: between the lines of the section, and before the section itself.
  let length = 0;

  for (const line of lines) {
    const lineLength = inlineToText(line).length + 1;

    if (length + lineLength > budget) {
      break;
    }

    kept.push(line);
    length += lineLength;
  }

  return kept;
};
