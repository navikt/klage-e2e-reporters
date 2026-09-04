/**
 * Deletes the Slack reports the manual report script posted, and leaves everything else in the channel. Only
 * threads whose main message was posted by the test bot, for this repository, are touched, and the whole thread
 * goes with it: replies, uploaded files and the messages sharing them.
 *
 * ```sh
 * bun run clean:slack            # lists what would be deleted, from the last three days
 * bun run clean:slack --days=7   # a different window
 * bun run clean:slack --delete   # deletes it
 * ```
 *
 * Bun reads `slack_e2e_token` and `klage_notifications_channel` from `.env`.
 */
import { type ConversationsHistoryResponse, type ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { delay } from '@/functions';
import { BOT_NAME, REPOSITORY } from '@/slack-reporter/test/constants';

const PAGE_SIZE = 200;

/** Whole days back from midnight today, unless `--days=` says otherwise. */
const DEFAULT_DAYS = 3;

const DAYS_FLAG = '--days=';

/** `chat.delete` and `files.delete` are rate limited per method, so the deletions are spaced out. */
const DELETE_INTERVAL = 300;

/** Errors that only mean the object is already gone. */
const ALREADY_GONE = new Set(['message_not_found', 'file_not_found', 'file_deleted']);

const SUMMARY_LENGTH = 80;

/** Local Norwegian date and time, so the output lines up with the timestamps Slack shows. */
const DATE_TIME = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'short', timeStyle: 'medium' });

const DRY_RUN = !process.argv.includes('--delete');

const token = process.env.slack_e2e_token ?? '';
const channel = process.env.klage_notifications_channel ?? '';

const client = new WebClient(token);

type HistoryMessage = NonNullable<ConversationsHistoryResponse['messages']>[number];
type ThreadMessage = NonNullable<ConversationsRepliesResponse['messages']>[number];

let failures = 0;

/**
 * The bot the token belongs to, so `--delete` cannot reach another bot's messages. `auth.test` needs no scope
 * of its own, and `bot_id` survives `chat.update`, unlike the username a message was posted with.
 */
let selfBotId: string | undefined;

const main = async () => {
  if (token.length === 0 || channel.length === 0) {
    console.error('Missing env variables: slack_e2e_token, klage_notifications_channel. Bun reads them from .env.');
    process.exit(1);
  }

  selfBotId = (await client.auth.test()).bot_id;

  if (selfBotId === undefined) {
    console.error('The token does not belong to a bot, so its own messages cannot be identified.');
    process.exit(1);
  }

  const since = startOfDay(getDays());

  console.info(`${DRY_RUN ? 'Dry run' : 'Deleting'}: reports posted since ${DATE_TIME.format(since)}.`);

  const messages = await getHistory(since);
  const reports = messages.filter(isTestReport);

  logKept(messages);

  if (reports.length === 0) {
    console.info(`No test reports among ${messages.length} messages.`);
    return;
  }

  let messageCount = 0;
  let fileCount = 0;

  for (const report of reports) {
    const { ts } = report;

    if (ts === undefined) {
      continue;
    }

    const thread = await getThread(ts);
    const files = getFileIds(thread);

    console.info(`${describe(report)} — ${thread.length} messages, ${files.length} files`);

    messageCount += thread.length;
    fileCount += files.length;

    if (!DRY_RUN) {
      await deleteThread(thread, files);
    }
  }

  const verb = DRY_RUN ? 'Would delete' : 'Deleted';

  console.info(`${verb} ${reports.length} threads, ${messageCount} messages and ${fileCount} files.`);

  if (DRY_RUN) {
    console.info('Re-run with --delete to actually delete them.');
  }

  if (failures > 0) {
    console.error(`${failures} deletions failed.`);
    process.exit(1);
  }
};

/** Midnight, local time, `daysAgo` days back. */
const startOfDay = (daysAgo: number): Date => {
  const start = new Date();

  start.setDate(start.getDate() - daysAgo);
  start.setHours(0, 0, 0, 0);

  return start;
};

const getDays = (): number => {
  const flag = process.argv.find((argument) => argument.startsWith(DAYS_FLAG));

  if (flag === undefined) {
    return DEFAULT_DAYS;
  }

  const value = flag.slice(DAYS_FLAG.length);
  const days = Number.parseInt(value, 10);

  // `Number.parseInt` stops at the first character it cannot read, so the round trip rejects the rest.
  if (!Number.isInteger(days) || days < 0 || `${days}` !== value) {
    console.error(`Invalid ${DAYS_FLAG}${value}. It takes a whole number of days, 0 or more.`);
    process.exit(1);
  }

  return days;
};

const getHistory = async (since: Date): Promise<HistoryMessage[]> => {
  const oldest = `${Math.floor(since.getTime() / 1_000)}`;
  const messages: HistoryMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.conversations.history({ channel, oldest, limit: PAGE_SIZE, cursor });

    messages.push(...(response.messages ?? []));
    cursor = response.response_metadata?.next_cursor;
  } while (cursor !== undefined && cursor.length > 0);

  return messages;
};

/** `conversations.replies` returns the main message as the first message of the thread. */
const getThread = async (ts: string): Promise<ThreadMessage[]> => {
  const messages: ThreadMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.conversations.replies({ channel, ts, limit: PAGE_SIZE, cursor });

    messages.push(...(response.messages ?? []));
    cursor = response.response_metadata?.next_cursor;
  } while (cursor !== undefined && cursor.length > 0);

  return messages;
};

/**
 * Both the bot and the repository have to match: the bot id rules out everyone else's messages, and the
 * repository rules out anything but the fake runs, in case the token is ever shared with a real reporter.
 */
const isTestReport = (message: HistoryMessage): boolean =>
  message.bot_id !== undefined && message.bot_id === selfBotId && hasMarker(message);

/** The reporter names the repository in the context line of the main message, and in its fallback text. */
const hasMarker = ({ text, blocks, attachments }: HistoryMessage): boolean =>
  JSON.stringify([text, blocks, attachments]).includes(REPOSITORY);

/** Partial matches, so messages the tests left behind are not lost silently. */
const logKept = (messages: HistoryMessage[]) => {
  const kept = messages.filter(
    (message) => !isTestReport(message) && (message.username === BOT_NAME || hasMarker(message)),
  );

  if (kept.length === 0) {
    return;
  }

  console.info(`Keeping ${kept.length} messages that only partly match:`);

  for (const message of kept) {
    console.info(`  ${describe(message)} (${message.username ?? 'no username'})`);
  }
};

const deleteThread = async (messages: ThreadMessage[], files: string[]) => {
  // Deleting a file also removes the message that shared it, so the files go first.
  for (const file of files) {
    await remove(`file ${file}`, () => client.files.delete({ file }));
  }

  // Newest first, so the main message goes last and an interrupted run can still find the rest through it.
  const timestamps = messages.flatMap(({ ts }) => (ts === undefined ? [] : [ts])).reverse();

  for (const ts of timestamps) {
    await remove(`message ${ts}`, () => client.chat.delete({ channel, ts }));
  }
};

const remove = async (target: string, deleteObject: () => Promise<unknown>) => {
  try {
    await deleteObject();
  } catch (error) {
    const code = getErrorCode(error);

    if (code === undefined || !ALREADY_GONE.has(code)) {
      logError(`Failed to delete ${target}.`, error);
      failures++;
    }
  }

  await delay(DELETE_INTERVAL);
};

const logError = (message: string, error: unknown) => {
  const code = getErrorCode(error);

  console.error(code === undefined ? message : `${message} Slack said: ${code}.`, code === undefined ? error : '');

  if (code === 'missing_scope') {
    console.error(
      'The token needs channels:history, or groups:history in a private channel, to look up what was posted,',
      'in addition to chat:write and files:write.',
    );
  }
};

const getErrorCode = (error: unknown): string | undefined =>
  (error as { data?: { error?: string } } | null)?.data?.error;

const getFileIds = (messages: ThreadMessage[]): string[] =>
  messages.flatMap(({ files }) => (files ?? []).flatMap(({ id }) => (id === undefined ? [] : [id])));

const describe = ({ ts, text, attachments }: HistoryMessage): string => {
  const [firstLine = ''] = summaryText(text, attachments).split('\n');
  const summary = firstLine.length > SUMMARY_LENGTH ? `${firstLine.slice(0, SUMMARY_LENGTH)}…` : firstLine;

  return `${formatTimestamp(ts)} — ${summary}`;
};

/** A colored message carries its text as the fallback of the attachment holding the blocks, not as its own. */
const summaryText = (text: string | undefined, attachments: HistoryMessage['attachments']): string => {
  if (text !== undefined && text.length > 0) {
    return text;
  }

  return (attachments ?? []).map(({ fallback }) => fallback ?? '').find((fallback) => fallback.length > 0) ?? '';
};

/** Slack timestamps are seconds, with a microsecond fraction, in a string. */
const formatTimestamp = (ts: string | undefined): string => {
  const seconds = ts === undefined ? Number.NaN : Number.parseFloat(ts);

  return Number.isFinite(seconds) ? DATE_TIME.format(new Date(seconds * 1_000)) : 'unknown time';
};

try {
  await main();
} catch (error) {
  logError('The cleanup failed.', error);
  process.exit(1);
}
