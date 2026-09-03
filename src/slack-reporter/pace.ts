import { delay } from '@/functions';
import { REPLY_INTERVAL } from '@/slack-reporter/constants';

/**
 * Keeps the thread within the one message per second per channel Slack allows, by holding a message back until
 * the interval since the previous one has passed.
 *
 * Timed rather than slept off after each message: a run posts the details of a failing test as it happens, and
 * two failures minutes apart must not pay for a gap that has long since gone by. Nothing is waited for when
 * there is nothing to post either, so a report with no warnings and no slow tests ends when its last message
 * does.
 */
export class Pace {
  private last = 0;

  /** @param interval The shortest gap between two messages. */
  constructor(private interval: number = REPLY_INTERVAL) {}

  /** Resolves when the next message may be posted, and counts it as posted then. */
  async next(): Promise<void> {
    const wait = this.last + this.interval - Date.now();

    if (wait > 0) {
      await delay(wait);
    }

    this.last = Date.now();
  }
}
