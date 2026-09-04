import type { ContextPart } from '@/slack-reporter/blocks';

const env = (name: string, fallback: string): string => {
  const value = process.env[name];

  return value === undefined || value.length === 0 ? fallback : value;
};

const UNKNOWN = '<unknown>';

const VERSION = env('VERSION', 'unknown');
const GITHUB_ACTOR = env('GITHUB_ACTOR', UNKNOWN);
const GITHUB_REPOSITORY = env('GITHUB_REPOSITORY', UNKNOWN);
/** `GITHUB_HEAD_REF` is the source branch of a pull request, `GITHUB_REF_NAME` the branch/tag of every other event. */
const GITHUB_BRANCH = env('GITHUB_HEAD_REF', env('GITHUB_REF_NAME', env('GITHUB_REF', UNKNOWN)));

/** What triggered the run, shown below every main message. Read on import. */
export const TRIGGER = {
  repository: { value: GITHUB_REPOSITORY },
  branch: { label: 'branch', value: GITHUB_BRANCH },
  actor: { label: 'triggered by', value: GITHUB_ACTOR },
  version: { label: 'E2E version', value: VERSION },
} satisfies Record<string, ContextPart>;
