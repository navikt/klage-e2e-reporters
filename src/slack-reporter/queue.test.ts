import { describe, expect, spyOn, test } from 'bun:test';
import { delay } from '@/functions';
import { ReplyQueue } from '@/slack-reporter/queue';

/** What the queue logged while it drained, kept out of the test output. */
const errorsWhile = async (run: () => Promise<void>): Promise<string[]> => {
  const spy = spyOn(console, 'error').mockImplementation(() => undefined);

  await run();

  const calls = spy.mock.calls.map(([notice]) => String(notice));

  spy.mockRestore();

  return calls;
};

describe('ReplyQueue', () => {
  test('posts the replies one at a time, in the order they were queued', async () => {
    const queue = new ReplyQueue();
    const posted: string[] = [];
    let posting = 0;

    const post = (name: string) => async () => {
      posting++;

      // A reply is several Slack calls, so two of them must never be in flight at once.
      expect(posting).toBe(1);

      await delay(5);

      posted.push(name);
      posting--;
    };

    queue.add('first', post('first'));
    queue.add('second', post('second'));
    queue.add('third', post('third'));

    await queue.drain();

    expect(posted).toEqual(['first', 'second', 'third']);
  });

  // A rejection here is never awaited by Playwright, so an unhandled one would take the whole run with it.
  test('reports a reply that could not be posted, and posts the ones after it', async () => {
    const queue = new ReplyQueue();
    const posted: string[] = [];

    const errors = await errorsWhile(async () => {
      queue.add('the warnings', () => Promise.reject(new Error('ratelimited')));
      queue.add('the slow tests', async () => void posted.push('the slow tests'));

      await queue.drain();
    });

    expect(posted).toEqual(['the slow tests']);
    expect(errors).toEqual(['Failed to post the warnings to Slack.']);
  });

  test('drains a reply that was queued while it was draining', async () => {
    const queue = new ReplyQueue();
    const posted: string[] = [];

    queue.add('first', async () => {
      posted.push('first');
      queue.add('second', async () => void posted.push('second'));
    });

    await queue.drain();

    expect(posted).toEqual(['first', 'second']);
  });

  test('resolves at once when nothing has been queued', async () => {
    await expect(new ReplyQueue().drain()).resolves.toBeUndefined();
  });
});
