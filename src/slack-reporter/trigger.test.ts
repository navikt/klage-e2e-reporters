import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { getTrigger, warnAboutMissingTrigger } from '@/slack-reporter/trigger';

const VARIABLES = [
  'GITHUB_REPOSITORY',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
  'GITHUB_REF',
  'GITHUB_ACTOR',
  'VERSION',
] as const;

type Variable = (typeof VARIABLES)[number];

/** Whatever the machine running the tests has, put back once they are done. */
const ORIGINAL = VARIABLES.map((name) => [name, process.env[name]] as const);

const setEnv = (values: Partial<Record<Variable, string>>) => {
  for (const name of VARIABLES) {
    const value = values[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
};

/** The tests run on GitHub Actions too, where every one of these is already set. */
beforeEach(() => setEnv({}));

afterAll(() => {
  for (const [name, value] of ORIGINAL) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('getTrigger', () => {
  test('reads each field from its variable', () => {
    setEnv({
      GITHUB_REPOSITORY: 'navikt/kabin',
      GITHUB_REF_NAME: 'feature/login',
      GITHUB_ACTOR: 'someone',
      VERSION: 'a1b2c3d',
    });

    expect(getTrigger()).toEqual({
      repository: 'navikt/kabin',
      branch: 'feature/login',
      actor: 'someone',
      version: 'a1b2c3d',
    });
  });

  test('reads the branch from `GITHUB_REF_NAME` alone', () => {
    // The workflow resolves the ref of its own event and hands over the answer, so nothing else is consulted.
    setEnv({ GITHUB_HEAD_REF: 'from-head-ref', GITHUB_REF: 'refs/heads/from-ref' });

    expect(getTrigger().branch).toBe('unknown');
  });

  test('keeps a value that only looks falsy', () => {
    // A version of `0` is still a version: the check is about content, not truthiness.
    setEnv({ VERSION: '0' });

    expect(getTrigger().version).toBe('0');
  });

  test('falls back to unknown when the environment holds nothing', () => {
    expect(getTrigger()).toEqual({
      repository: 'unknown',
      branch: 'unknown',
      actor: 'unknown',
      version: 'unknown',
    });
  });

  test('takes what is given over the environment', () => {
    setEnv({
      GITHUB_REPOSITORY: 'navikt/from-env',
      GITHUB_REF_NAME: 'from-env',
      GITHUB_ACTOR: 'from-env',
      VERSION: '0.0.0',
    });

    expect(getTrigger({ repository: 'navikt/klang', branch: 'main', actor: 'someone', version: '1.2.3' })).toEqual({
      repository: 'navikt/klang',
      branch: 'main',
      actor: 'someone',
      version: '1.2.3',
    });
  });

  describe('treats a value given as empty or undefined as one that was not given', () => {
    test('falls through to the environment', () => {
      // A workflow passing `${{ github.head_ref }}` hands over an empty string on every event but a pull request.
      setEnv({ GITHUB_REF_NAME: 'main' });

      expect(getTrigger({ branch: '' }).branch).toBe('main');
    });

    test('never lets an undefined value clobber the environment', () => {
      // `trigger: { branch: process.env.SOMETHING }` is a normal thing to write, and normally undefined.
      setEnv({ GITHUB_REF_NAME: 'main' });

      expect(getTrigger({ branch: undefined }).branch).toBe('main');
    });

    test('falls through to unknown when the environment is empty too', () => {
      expect(getTrigger({ repository: '', branch: '', actor: '', version: '' })).toEqual({
        repository: 'unknown',
        branch: 'unknown',
        actor: 'unknown',
        version: 'unknown',
      });
    });
  });
});

describe('warnAboutMissingTrigger', () => {
  const warn = () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => undefined);

    warnAboutMissingTrigger(getTrigger());

    const calls = spy.mock.calls;
    spy.mockRestore();

    return calls.map((args) => args.join(' '));
  };

  test('says nothing when everything was found', () => {
    setEnv({
      GITHUB_REPOSITORY: 'navikt/klang',
      GITHUB_REF_NAME: 'main',
      GITHUB_ACTOR: 'someone',
      VERSION: '1.2.3',
    });

    expect(warn()).toEqual([]);
  });

  test('names the field and the variable it looked for', () => {
    // A container handed the metadata by hand, as these reporters always are, and never handed the branch.
    setEnv({ GITHUB_REPOSITORY: 'navikt/kabin', GITHUB_ACTOR: 'someone', VERSION: 'a1b2c3d' });

    const [message = ''] = warn();

    expect(message).toContain('branch (GITHUB_REF_NAME)');
    expect(message).not.toContain('repository');
    expect(message).not.toContain('actor');
  });

  test('names every field that is missing', () => {
    const [message = ''] = warn();

    expect(message).toContain('repository (GITHUB_REPOSITORY)');
    expect(message).toContain('branch (GITHUB_REF_NAME)');
    expect(message).toContain('actor (GITHUB_ACTOR)');
    expect(message).toContain('version (VERSION)');
  });
});
