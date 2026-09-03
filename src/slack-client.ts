import fs, { createReadStream, type ReadStream } from 'node:fs';
import { App, isCodedError } from '@slack/bolt';
import type { AnyBlock } from '@slack/types';
import type { ChatPostMessageResponse, ChatUpdateResponse, WebAPICallResult } from '@slack/web-api';

export interface SlackClientOptions {
  /** Environment variable name for the Slack bot token. @default 'slack_e2e_token' */
  tokenEnvVar?: string;
  /** Environment variable name for the Slack channel. @default 'klage_notifications_channel' */
  channelEnvVar?: string;
  /** Environment variable name for the Slack signing secret. @default 'slack_signing_secret' */
  signingSecretEnvVar?: string;
  /** Bot display name in Slack. */
  botName: string;
  /**
   * Bot icon URL in Slack, as a full URL or a GitHub raw path (e.g. `navikt/klang/main/frontend/assets/logo192.png`).
   * Defaults to the Slack app's own icon.
   */
  iconUrl?: string;
}

class SlackClient {
  private app: App;

  constructor(
    private token: string,
    private channel: string,
    signingSecret: string,
    private botName: string,
    private iconUrl: string | undefined,
  ) {
    this.app = new App({ token, signingSecret });
  }

  /**
   * A `color` puts the blocks in an attachment, which draws a bar in that color along the left edge. The text
   * then rides along as the fallback of the attachment, because Slack renders a message with both as two parts.
   */
  async postMessage(message: string, blocks?: AnyBlock[], color?: string) {
    const base = {
      token: this.token,
      channel: this.channel,
      username: this.botName,
      icon_url: this.iconUrl,
    };

    const response = await this.app.client.chat.postMessage(
      color === undefined || blocks === undefined
        ? { ...base, text: message, blocks }
        : { ...base, attachments: [{ color, fallback: message, blocks }] },
    );

    return new SlackMessageThread(this, response);
  }

  async uploadFile(
    filePath: string,
    filename: string = filePath,
    title: string = filePath,
    message?: string,
    threadMessage?: ChatPostMessageResponse | ChatUpdateResponse,
  ) {
    return await this.uploadFileBuffer(createReadStream(filePath), filename, title, message, threadMessage);
  }

  async uploadFileBuffer(
    fileBuffer: Buffer | ReadStream,
    filename?: string,
    title?: string,
    message?: string,
    threadMessage?: ChatPostMessageResponse | ChatUpdateResponse,
  ) {
    try {
      return await this.uploadFiles(
        [{ file: fileBuffer, filename: filename ?? 'attachment', title }],
        message,
        undefined,
        threadMessage,
      );
    } catch (error) {
      // Only a buffer has a size that can still be read here: the stream has already been consumed by the upload.
      const size = Buffer.isBuffer(fileBuffer) ? ` (${fileBuffer.byteLength} bytes)` : '';
      const errorMessage = `Failed to upload file${size}: ${filename ?? '<no filename>'}`;

      console.error(errorMessage);

      // Reporting the failure must not replace it with one of its own.
      try {
        if (threadMessage === undefined) {
          await this.postMessage(errorMessage);
        } else {
          await this.postReply(threadMessage, errorMessage);
        }
      } catch (reportError) {
        console.error('Failed to report the upload failure to Slack.', reportError);
      }

      throw error;
    }
  }

  /**
   * Uploads several files as a single message, optionally as a reply in a thread.
   *
   * The files are uploaded without a channel, so Slack does not post them itself, and are attached to a message
   * posted here instead. This keeps the thread order predictable.
   */
  async uploadFiles(
    files: SlackFileUpload[],
    message?: string,
    blocks?: AnyBlock[],
    threadMessage?: ChatPostMessageResponse | ChatUpdateResponse,
  ) {
    if (files.length === 0) {
      throw new Error('Cannot upload an empty list of files.');
    }

    const upload = await this.app.client.files.uploadV2({
      token: this.token,
      file_uploads: files.map(({ file, filename, title }) => ({ file, filename, title: title ?? filename })),
    });

    const fileIds = uploadedFileIds(upload);
    const channel = threadMessage?.channel ?? this.channel;
    const thread_ts = threadMessage?.ts;
    // The files are attached afterwards, so the message needs text of its own.
    const text = message ?? files.map(({ filename }) => filename).join(', ');

    let posted: ChatPostMessageResponse;

    // Without a message to share them the files are out of reach, since they were uploaded without a channel,
    // so they are discarded rather than left behind in the workspace storage.
    try {
      posted = await this.app.client.chat.postMessage({
        token: this.token,
        channel,
        text,
        blocks,
        username: this.botName,
        icon_url: this.iconUrl,
        ...(thread_ts === undefined ? {} : { thread_ts }),
      });
    } catch (error) {
      await this.discardFiles(fileIds);

      throw error;
    }

    if (posted.ts === undefined) {
      await this.discardFiles(fileIds);

      throw new Error('Could not attach the uploaded files to a message.');
    }

    // The message already exists, so a failure here leaves it without its attachments rather than throwing,
    // which would make the caller post a second one. The files are discarded, since nothing can reach them:
    // they were uploaded without a channel, and the message that would have shared them never got them.
    try {
      return await this.app.client.chat.update({
        token: this.token,
        channel: posted.channel ?? channel,
        ts: posted.ts,
        text,
        blocks,
        file_ids: fileIds,
      });
    } catch (error) {
      console.error(`Failed to attach ${files.length} uploaded files to the message.`, error);

      await this.discardFiles(fileIds);

      // Still no throwing: the caller would post a duplicate details message.
      try {
        const names = files.map(({ filename }) => filename).join(', ');

        // Replying to the message that was posted here would nest a thread inside a thread, so the reply goes
        // to the thread it belongs to.
        await this.postReply(
          threadMessage ?? posted,
          `${files.length} attachments could not be added to this message: ${names}`,
        );
      } catch (replyError) {
        console.error('Failed to report the missing attachments to Slack.', replyError);
      }

      return posted;
    }
  }

  /** Best effort: an orphaned upload is invisible in Slack, but still counts against the workspace storage. */
  private async discardFiles(fileIds: string[]) {
    const results = await Promise.allSettled(
      fileIds.map((file) => this.app.client.files.delete({ token: this.token, file })),
    );

    const failed = results.filter(({ status }) => status === 'rejected').length;

    if (failed > 0) {
      console.error(`Failed to delete ${failed} of ${fileIds.length} orphaned file uploads.`);
    }
  }

  async updateMessage(
    message: ChatPostMessageResponse | ChatUpdateResponse,
    newMessage: string,
    blocks?: AnyBlock[],
    color?: string,
  ) {
    if (message.ts === undefined) {
      throw new Error('Could not update message.');
    }

    const base = {
      token: this.token,
      channel: message?.channel ?? this.channel,
      ts: message.ts,
    };

    try {
      const response = await this.app.client.chat.update(
        color === undefined || blocks === undefined
          ? { ...base, text: newMessage, blocks }
          : { ...base, attachments: [{ color, fallback: newMessage, blocks }] },
      );

      return new SlackMessageThread(this, response);
    } catch (error) {
      if (isCodedError(error)) {
        console.error('Failed to update message with', error.code, newMessage.length);
      }

      this.postReply(message, ['Failed to update Slack message to:', '```', newMessage, '```'].join('\n'));
      throw error;
    }
  }

  async postReply(threadMessage: ChatPostMessageResponse | ChatUpdateResponse, reply: string, blocks?: AnyBlock[]) {
    if (threadMessage.ts === undefined) {
      throw new Error('Could not reply to message.');
    }

    await this.app.client.chat.postMessage({
      token: this.token,
      channel: threadMessage?.channel ?? this.channel,
      thread_ts: threadMessage.ts,
      text: reply,
      blocks,
      username: this.botName,
      icon_url: this.iconUrl,
    });

    return threadMessage;
  }
}

/** The file ids of a `files.uploadV2` response, in upload order. */
const uploadedFileIds = (response: WebAPICallResult): string[] => {
  const { files } = response as WebAPICallResult & { files?: { files?: { id?: string }[] }[] };

  return (files ?? []).flatMap(({ files: group }) =>
    (group ?? []).flatMap(({ id }) => (typeof id === 'string' ? [id] : [])),
  );
};

const resolveIconUrl = (iconUrl: string | undefined): string | undefined => {
  if (iconUrl === undefined) {
    return undefined;
  }

  if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }

  return `https://raw.githubusercontent.com/${iconUrl}`;
};

export const createSlackClient = (options: SlackClientOptions): SlackClient | null => {
  const tokenEnvVar = options.tokenEnvVar ?? 'slack_e2e_token';
  const channelEnvVar = options.channelEnvVar ?? 'klage_notifications_channel';
  const signingSecretEnvVar = options.signingSecretEnvVar ?? 'slack_signing_secret';

  const token = process.env[tokenEnvVar];
  const channel = process.env[channelEnvVar];
  const secret = process.env[signingSecretEnvVar];

  if (
    typeof token === 'string' &&
    token.length > 0 &&
    typeof channel === 'string' &&
    channel.length > 0 &&
    typeof secret === 'string' &&
    secret.length > 0
  ) {
    return new SlackClient(token, channel, secret, options.botName, resolveIconUrl(options.iconUrl));
  }

  console.warn(
    `Could not create Slack client. Missing env variables: ${tokenEnvVar}, ${channelEnvVar}, ${signingSecretEnvVar}`,
  );

  return null;
};

export interface SlackFileUpload {
  /** File contents as a buffer or stream, or a path to a file on disk. */
  file: Buffer | ReadStream | string;
  /** Name of the file, including extension. */
  filename: string;
  /** File title shown in Slack. @default filename */
  title?: string;
}

export class SlackMessageThread {
  constructor(
    private app: SlackClient,
    private message: ChatPostMessageResponse | ChatUpdateResponse,
  ) {
    /* Empty */
  }

  update = (newMessage: string, blocks?: AnyBlock[], color?: string) =>
    this.app.updateMessage(this.message, newMessage, blocks, color);

  reply = (reply: string, blocks?: AnyBlock[]) => this.app.postReply(this.message, reply, blocks);

  replyFilePath = (filePath: string, reply?: string, title?: string, filename?: string) => {
    // https://github.com/microsoft/playwright/issues/12711
    if (fs.existsSync(filePath)) {
      return this.app.uploadFile(filePath, filename, title, reply, this.message);
    }

    console.error(`Tried to upload file ${filePath ?? ''}, but it did not exist.`);
  };

  replyFileBuffer = (file: Buffer, reply?: string, title?: string, filename?: string) =>
    this.app.uploadFileBuffer(file, filename, title, reply, this.message);

  /** Replies to the thread with a single message holding all the files. */
  replyFiles = (files: SlackFileUpload[], reply?: string, blocks?: AnyBlock[]) =>
    this.app.uploadFiles(files, reply, blocks, this.message);
}
