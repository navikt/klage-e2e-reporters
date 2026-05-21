export { getFullStatusIcon, getTestStatusIcon, getTestTitle, SlackIcon } from '@/functions';
export { type SlackClientOptions, SlackMessageThread } from '@/slack-client';
export { default as SlackReporter, type SlackReporterOptions } from '@/slack-reporter';
export { default as StatusReporter, type StatusReporterOptions } from '@/status-reporter';

import type { SlackReporterOptions } from '@/slack-reporter';
import type { StatusReporterOptions } from '@/status-reporter';

/**
 * Creates a Playwright reporter config entry for the Slack reporter.
 *
 * @example
 * ```ts
 * import { slackReporter, statusReporter } from '@navikt/klage-e2e-reporters';
 *
 * export default defineConfig({
 *   reporter: [['list'], slackReporter({ botName: 'Klang E2E', iconUrl: '...' }), statusReporter({ name: 'Klang E2E' })],
 * });
 * ```
 */
export const slackReporter = (
  options: SlackReporterOptions,
): ['@navikt/klage-e2e-reporters/slack', SlackReporterOptions] => ['@navikt/klage-e2e-reporters/slack', options];

/**
 * Creates a Playwright reporter config entry for the status reporter.
 */
export const statusReporter = (
  options?: StatusReporterOptions,
): ['@navikt/klage-e2e-reporters/status', StatusReporterOptions] => [
  '@navikt/klage-e2e-reporters/status',
  options ?? {},
];
