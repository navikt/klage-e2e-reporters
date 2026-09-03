import { shorten } from '@/functions';
import type { ContextPart } from '@/slack-reporter/blocks';
import { MAX_FIELD_LENGTH } from '@/slack-reporter/constants';

const UNKNOWN = 'unknown';

/** What triggered the run, shown below every main message. */
export interface Trigger {
  repository: string;
  branch: string;
  actor: string;
  version: string;
}

/**
 * The first value that carries something. Unset and empty both count as nothing: a workflow hands over a blank
 * string as readily as the environment holds one, and neither says anything about the run.
 */
const firstValue = (...values: (string | undefined)[]): string =>
  values.find((value) => value !== undefined && value.length > 0) ?? UNKNOWN;

/**
 * Read when the reporter is created: what was given, then the environment, then nothing at all. A value that is
 * unset or empty counts as nothing on either side, so a workflow can pass one that is only sometimes there
 * without clobbering the variable behind it.
 *
 * Nothing is inherited where these reporters run: a Naisjob holds only what its manifest was handed, so every
 * value is put there deliberately and there is no event to detect. On GitHub Actions `GITHUB_REF_NAME` is the
 * branch or tag of every event but a pull request, where it is the merge ref and `GITHUB_HEAD_REF` holds the
 * branch. Resolving that is the workflow's business, with `${{ github.head_ref || github.ref_name }}`.
 */
export const getTrigger = (given: Partial<Trigger> = {}): Trigger => ({
  repository: firstValue(given.repository, process.env.GITHUB_REPOSITORY),
  branch: firstValue(given.branch, process.env.GITHUB_REF_NAME),
  actor: firstValue(given.actor, process.env.GITHUB_ACTOR),
  version: firstValue(given.version, process.env.VERSION),
});

/** Each field with the variable it is read from, so the warning can name what to set. */
const VARIABLES = [
  ['repository', 'GITHUB_REPOSITORY'],
  ['branch', 'GITHUB_REF_NAME'],
  ['actor', 'GITHUB_ACTOR'],
  ['version', 'VERSION'],
] as const satisfies readonly (readonly [keyof Trigger, string])[];

/**
 * Names what could not be found, so a report that says `unknown` says why in the log of the run that produced
 * it. The reporter runs far from the workflow that configured it: a container holds only the variables it was
 * handed, and one that was never handed over is otherwise silent until the report is read.
 */
export const warnAboutMissingTrigger = (trigger: Trigger): void => {
  const missing = VARIABLES.filter(([field]) => trigger[field] === UNKNOWN).map(
    ([field, variable]) => `${field} (${variable})`,
  );

  if (missing.length === 0) {
    return;
  }

  console.warn(
    `Missing run metadata, reported to Slack as "${UNKNOWN}". Set the environment variable listed for each, or`,
    `pass it to the reporter's \`trigger\` option: ${missing.join('; ')}.`,
  );
};

/** The metadata as the context parts of the main message. Read from the environment, so every value is cut to fit. */
export const triggerParts = ({ repository, branch, actor, version }: Trigger) =>
  ({
    repository: { value: shorten(repository, MAX_FIELD_LENGTH) },
    branch: { label: 'branch', value: shorten(branch, MAX_FIELD_LENGTH) },
    actor: { label: 'triggered by', value: shorten(actor, MAX_FIELD_LENGTH) },
    version: { label: 'E2E version', value: shorten(version, MAX_FIELD_LENGTH) },
  }) satisfies Record<string, ContextPart>;
