/**
 * Reads a posted report back out of Slack and checks that it says what it should, files included.
 *
 * Neither of the things checked here shows up in the calls the reporter makes. A message that carries uploaded
 * files has to be posted in a particular way, and Slack drops the attachments of one posted wrongly without
 * failing the call. A message rewritten in place, from failed to flaky, is a `chat.update` that answers the
 * same whether it kept the files and the text or not. Only the thread itself can tell.
 */
import { type ConversationsHistoryResponse, WebClient } from '@slack/web-api';
import { delay, unescapeMrkdwn } from '@/functions';
import { MARKERS } from '@/slack-reporter/test/constants';

const PAGE_SIZE = 200;

/** Slack takes a moment to show a file on the message sharing it. */
const ATTEMPTS = 5;
const RETRY_INTERVAL = 2_000;

type HistoryMessage = NonNullable<ConversationsHistoryResponse['messages']>[number];

export interface ExpectedReport {
  /** The files the thread should carry, in any order. */
  files: string[];
  /** What the thread should say somewhere. */
  says: string[];
  /** What no message in the thread may say any more. */
  saysNoMore: string[];
}

interface Thread {
  files: string[];
  text: string;
}

/** @throws if the thread cannot be found, or is not what it should be. */
export const verifyReport = async (since: Date, expected: ExpectedReport) => {
  const client = new WebClient(process.env.slack_e2e_token ?? '');
  const channel = process.env.klage_notifications_channel ?? '';
  const files = [...expected.files].sort();

  let problems: string[] = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const thread = await getThread(client, channel, since);

    problems = check(thread, { ...expected, files });

    if (problems.length === 0) {
      console.info(`Verified ${thread.files.length} uploaded files and the outcome of every test in the thread.`);

      return;
    }

    if (attempt < ATTEMPTS) {
      await delay(RETRY_INTERVAL);
    }
  }

  throw new Error(['The report in Slack is not what it should be.', ...problems].join('\n'));
};

const check = ({ files, text }: Thread, expected: ExpectedReport): string[] => [
  ...(sameFiles(files, expected.files)
    ? []
    : [`  files expected: ${expected.files.join(', ')}`, `  files found:    ${files.join(', ') || 'nothing'}`]),
  ...expected.says.filter((says) => !text.includes(says)).map((says) => `  never said: ${says}`),
  ...expected.saysNoMore.filter((says) => text.includes(says)).map((says) => `  still says: ${says}`),
];

const sameFiles = (found: string[], expected: string[]) =>
  found.length === expected.length && found.every((name, index) => name === expected[index]);

/** The files and the text of the thread of the newest fake report. */
const getThread = async (client: WebClient, channel: string, since: Date): Promise<Thread> => {
  const oldest = `${Math.floor(since.getTime() / 1_000)}`;
  const { messages = [] } = await client.conversations.history({ channel, oldest, limit: PAGE_SIZE });
  // Newest first, and the run just posted, so the first match is the report that was just made.
  const report = messages.find(isTestReport);

  if (report?.ts === undefined) {
    throw new Error('Could not find the report that was just posted. The token needs channels:history to read it.');
  }

  const { messages: thread = [] } = await client.conversations.replies({ channel, ts: report.ts, limit: PAGE_SIZE });

  return {
    files: thread.flatMap(({ files }) => (files ?? []).map(({ name }) => name ?? 'unnamed')).sort(),
    // Slack holds the text as it was encoded, where a test title reads `Klage &gt; sender inn klagen`.
    text: thread.map(({ text }) => unescapeMrkdwn(text ?? '')).join('\n'),
  };
};

/** Every marker of the fake trigger has to be there, the way the cleanup script identifies a fake report. */
const isTestReport = ({ text, blocks, attachments }: HistoryMessage): boolean => {
  const rendered = JSON.stringify([text, blocks, attachments]);

  return MARKERS.every((marker) => rendered.includes(marker));
};
