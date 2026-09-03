import type { Trigger } from '@/slack-reporter/trigger';

/** The bot name the reports are posted with. */
export const BOT_NAME = 'Klage E2E reporter test';

/** The fake Playwright project name, shown with the failure details in the thread. */
export const PROJECT_NAME = 'fake-e2e-run';

/** The repository the fake runs claim to come from, shown in the context line of every main message. */
const REPOSITORY = 'navikt/klage-e2e-reporters';

/** Fixed, so every report reads the same whoever runs it, and the cleanup can always find it again. */
export const TRIGGER = {
  repository: REPOSITORY,
  branch: 'fake-branch',
  actor: 'fake-actor',
  version: 'fake-version',
} satisfies Trigger;

/**
 * Every one of these has to be in a main message before the cleanup treats it as a fake run. The repository on
 * its own is the real one, which a genuine report from this repository would carry too, so the fake branch,
 * actor and version have to be there as well.
 */
export const MARKERS = [REPOSITORY, TRIGGER.branch, TRIGGER.actor, TRIGGER.version];
