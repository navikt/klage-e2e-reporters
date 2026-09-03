export {
  asyncForEach,
  delay,
  formatDuration,
  getFullStatusIcon,
  getTestStatusIcon,
  getTestTitle,
  SlackIcon,
  stripAnsi,
  truncate,
} from '@/functions';
export { type SlackClientOptions, type SlackFileUpload, SlackMessageThread } from '@/slack-client';
export { default as SlackReporter, type SlackReporterOptions } from '@/slack-reporter';
export { default as StatusReporter, type StatusReporterOptions } from '@/status-reporter';

import type { SlackReporterOptions } from '@/slack-reporter';
import type { StatusReporterOptions } from '@/status-reporter';

/**
 * A Playwright reporter config entry for the Slack reporter.
 *
 * @example
 * ```ts
 * import { slackReporter } from '@navikt/klage-e2e-reporters';
 *
 * export default defineConfig({ reporter: [['list'], slackReporter({ botName: 'Klang E2E' })] });
 * ```
 */
export const slackReporter = (
  options: SlackReporterOptions,
): ['@navikt/klage-e2e-reporters/slack', SlackReporterOptions] => ['@navikt/klage-e2e-reporters/slack', options];

/**
 * A Playwright reporter config entry for the status reporter.
 *
 * @example
 * ```ts
 * import { statusReporter } from '@navikt/klage-e2e-reporters';
 *
 * export default defineConfig({ reporter: [['list'], statusReporter({ name: 'Klang E2E' })] });
 * ```
 */
export const statusReporter = (
  options: StatusReporterOptions,
): ['@navikt/klage-e2e-reporters/status', StatusReporterOptions] => ['@navikt/klage-e2e-reporters/status', options];
