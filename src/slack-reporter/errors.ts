import type { TestError } from '@playwright/test/reporter';
import { stripAnsi } from '@/functions';

export const errorMessage = (error: TestError) => stripAnsi(error.message ?? error.value ?? 'Unknown error').trim();

/** The complete error, as attached to the thread message of a failing test. */
export const formatError = (error: TestError): string => {
  const message = errorMessage(error);
  const parts = [message];

  if (error.snippet !== undefined) {
    parts.push(stripAnsi(error.snippet).trim());
  }

  if (error.stack !== undefined) {
    const stack = stripAnsi(error.stack).trim();

    parts.push(stack.startsWith(message) ? stack.slice(message.length).trim() : stack);
  }

  if (error.cause !== undefined) {
    parts.push(`Caused by: ${formatError(error.cause)}`);
  }

  return parts.filter((part) => part.length > 0).join('\n\n');
};
