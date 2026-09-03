/**
 * The thread replies, posted one after another. Tests finish on several workers at once, and a reply is several
 * Slack calls, so they are queued rather than raced: the thread then reads in the order the run happened in.
 *
 * Nothing can be awaited where a reply is queued: `onTestEnd` is synchronous, and Playwright drops whatever it
 * returns. A rejection nothing awaits would take the whole run with it, so a reply that cannot be posted is
 * reported here instead, and the ones after it are posted all the same.
 */
export class ReplyQueue {
  private pending: Promise<void> = Promise.resolve();

  /** @param name What is being posted, named in the error if it cannot be. */
  add(name: string, post: () => Promise<unknown>): void {
    this.pending = this.pending.then(async () => {
      try {
        await post();
      } catch (error) {
        console.error(`Failed to post ${name} to Slack.`, error);
      }
    });
  }

  /** Resolves once the queue has run dry, the replies queued while it was draining included. */
  async drain(): Promise<void> {
    let drained = this.pending;

    await drained;

    while (this.pending !== drained) {
      drained = this.pending;

      await drained;
    }
  }
}
