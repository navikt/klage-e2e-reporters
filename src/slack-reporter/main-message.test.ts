import { describe, expect, test } from 'bun:test';
import type { FullResult } from '@playwright/test/reporter';
import { toBlocksFallbackText } from '@/slack-reporter/blocks';
import { MAX_MESSAGE_LENGTH, MAX_RUNNING_TESTS } from '@/slack-reporter/constants';
import { formatMainMessage, getHeadline, type RunState } from '@/slack-reporter/main-message';
import type { Trigger } from '@/slack-reporter/trigger';
import type { RunningTest } from '@/slack-reporter/types';

const TRIGGER: Trigger = { repository: 'navikt/klage', branch: 'main', actor: 'someone', version: '1.2.3' };

const RESULT: FullResult = { status: 'passed', startTime: new Date(), duration: 65_000 };

const running = (count: number, titleLength: number, stepLength = 0): RunningTest[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `test ${index} `.padEnd(titleLength, 'x'),
    step: stepLength === 0 ? undefined : 'step '.padEnd(stepLength, 'x'),
    elapsed: 30_000,
  }));

const createState = (tests: RunningTest[]): RunState => ({
  counts: { passed: 3, flaky: 1, failed: 2, skipped: 0 },
  done: 6,
  total: 40,
  workers: 4,
  elapsed: 65_000,
  running: tests,
});

const render = (state: RunState, trigger: Trigger = TRIGGER) =>
  toBlocksFallbackText(formatMainMessage(state, trigger).blocks);

describe('formatMainMessage', () => {
  test('keeps the message within the budget, whatever is running', () => {
    const cases: [string, RunState, Trigger][] = [
      ['nothing running', createState([]), TRIGGER],
      ['long titles', createState(running(20, 3_000)), TRIGGER],
      ['long steps', createState(running(20, 30, 3_000)), TRIGGER],
      ['long titles and steps', createState(running(50, 3_000, 3_000)), TRIGGER],
      [
        'long metadata',
        createState(running(20, 3_000, 3_000)),
        { repository: 'r', branch: 'b', actor: 'a', version: 'v'.repeat(5_000) },
      ],
    ];

    for (const [name, state, trigger] of cases) {
      expect(render(state, trigger).length, name).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  test('lists every running test that fits', () => {
    const text = render(createState(running(3, 20)));

    expect(text).toContain('test 0');
    expect(text).toContain('test 2');
    expect(text).not.toContain('more tests');
  });

  test('notes the running tests the count limit left out', () => {
    const text = render(createState(running(MAX_RUNNING_TESTS + 4, 20)));

    expect(text).toContain('and 4 more tests');
  });

  test('names a single omitted running test in the singular', () => {
    const text = render(createState(running(MAX_RUNNING_TESTS + 1, 20)));

    expect(text).toContain('and 1 more test');
    expect(text).not.toContain('more tests');
  });

  test('notes the running tests the budget left out', () => {
    const text = render(createState(running(MAX_RUNNING_TESTS, 3_000, 3_000)));

    // The titles alone spend the budget long before the count limit does.
    expect(text).toMatch(/and \d+ more tests/);
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });

  test('keeps a test and the step it is on together', () => {
    const text = render(createState(running(MAX_RUNNING_TESTS, 200, 200)));
    const titles = text.match(/test \d+ /g) ?? [];
    const steps = text.match(/step x/g) ?? [];

    // The budget leaves some of them out, but never a title without its step.
    expect(titles.length).toBeGreaterThan(0);
    expect(steps).toHaveLength(titles.length);
  });

  test('drops the running list from a finished run', () => {
    const state = createState(running(3, 20));
    const text = toBlocksFallbackText(formatMainMessage(state, TRIGGER, getHeadline(RESULT, state)).blocks);

    expect(text).not.toContain('test 0');
  });
});
