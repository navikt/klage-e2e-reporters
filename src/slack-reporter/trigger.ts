import { shorten } from '@/functions';
import type { ContextPart } from '@/slack-reporter/blocks';
import { MAX_FIELD_LENGTH } from '@/slack-reporter/constants';

const env = (name: string, fallback: string): string => {
  const value = process.env[name];

  return value === undefined || value.length === 0 ? fallback : value;
};

const UNKNOWN = 'unknown';

/** What triggered the run, shown below every main message. */
export interface Trigger {
  repository: string;
  branch: string;
  actor: string;
  version: string;
}

/**
 * Read when the reporter is created, from what GitHub Actions sets, unless the value is given directly.
 *
 * `GITHUB_HEAD_REF` is the source branch of a pull request, `GITHUB_REF_NAME` the branch or tag of every other
 * event, so the branch is the first of them that is set.
 */
export const getTrigger = (trigger: Partial<Trigger> = {}): Trigger => ({
  repository: trigger.repository ?? env('GITHUB_REPOSITORY', UNKNOWN),
  branch: trigger.branch ?? env('GITHUB_HEAD_REF', env('GITHUB_REF_NAME', env('GITHUB_REF', UNKNOWN))),
  actor: trigger.actor ?? env('GITHUB_ACTOR', UNKNOWN),
  version: trigger.version ?? env('VERSION', UNKNOWN),
});

/** The metadata as the context parts of the main message. Read from the environment, so every value is cut to fit. */
export const triggerParts = ({ repository, branch, actor, version }: Trigger) =>
  ({
    repository: { value: shorten(repository, MAX_FIELD_LENGTH) },
    branch: { label: 'branch', value: shorten(branch, MAX_FIELD_LENGTH) },
    actor: { label: 'triggered by', value: shorten(actor, MAX_FIELD_LENGTH) },
    version: { label: 'E2E version', value: shorten(version, MAX_FIELD_LENGTH) },
  }) satisfies Record<string, ContextPart>;
