import { describe, expect, test } from 'bun:test';
import { delay } from '@/functions';
import { Pace } from '@/slack-reporter/pace';

/** Short enough to keep the suite quick, long enough to measure. */
const INTERVAL = 50;

/** How long each message waited its turn. */
const messages = async (pace: Pace, count: number): Promise<number[]> => {
  const waits: number[] = [];

  for (let index = 0; index < count; index++) {
    const before = Date.now();

    await pace.next();

    waits.push(Date.now() - before);
  }

  return waits;
};

describe('Pace', () => {
  test('lets the first message through at once', async () => {
    const [first = INTERVAL] = await messages(new Pace(INTERVAL), 1);

    expect(first).toBeLessThan(INTERVAL);
  });

  test('holds the next message back until the interval has passed', async () => {
    const [, second = 0] = await messages(new Pace(INTERVAL), 2);

    // Timers fire on or just after their deadline, and the clock is read in whole milliseconds.
    expect(second).toBeGreaterThanOrEqual(INTERVAL - 1);
  });

  // A run posts the details of a failing test as it fails, so the gaps are the run's own.
  test('waits for nothing when the interval has already gone by', async () => {
    const pace = new Pace(INTERVAL);

    await pace.next();
    await delay(INTERVAL);

    const before = Date.now();

    await pace.next();

    expect(Date.now() - before).toBeLessThan(INTERVAL);
  });
});
