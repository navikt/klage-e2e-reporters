import fs, { createReadStream, type ReadStream } from 'node:fs';
import { buffer } from 'node:stream/consumers';
import { App, isCodedError } from '@slack/bolt';
import type { ChatPostMessageResponse, ChatUpdateResponse } from '@slack/web-api';

export interface SlackClientOptions {
  /** Environment variable name for the Slack bot token. @default 'slack_e2e_token' */
  tokenEnvVar?: string;
  /** Environment variable name for the Slack channel. @default 'klage_notifications_channel' */
  channelEnvVar?: string;
  /** Environment variable name for the Slack signing secret. @default 'slack_signing_secret' */
  signingSecretEnvVar?: string;
  /** Environment variable name for tag channel on error flag. @default 'tag_channel_on_error' */
  tagChannelOnErrorEnvVar?: string;
  /** Default value for tag channel on error. @default 'true' */
  tagChannelOnErrorDefault?: string;
  /** Bot display name in Slack. */
  botName: string;
  /**
   * Bot icon URL in Slack. If omitted, the Slack app's default icon is used.
   * Accepts a full URL or a GitHub raw path (e.g. `navikt/klang/main/frontend/assets/logo192.png`).
   */
  iconUrl?: string;
}

class SlackClient {
  private app: App;

  constructor(
    private token: string,
    private channel: string,
    signingSecret: string,
    public tagChannelOnError: string,
    private botName: string,
    private iconUrl: string | undefined,
  ) {
    this.app = new App({ token, signingSecret });
  }

  async postMessage(message: string) {
    const response = await this.app.client.chat.postMessage({
      token: this.token,
      channel: this.channel,
      text: message,
      username: this.botName,
      icon_url: this.iconUrl,
    });

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
      const channel_id = threadMessage?.channel ?? this.channel;
      const thread_ts = threadMessage?.ts;

      const params = { token: this.token, file: fileBuffer, filename, channel_id, title, initial_comment: message };

      return await this.app.client.files.uploadV2(thread_ts === undefined ? params : { ...params, thread_ts });
    } catch (error) {
      const bufferSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.byteLength : (await buffer(fileBuffer)).byteLength;
      const errorMessage = `Failed to upload file (${bufferSize} bytes): ${filename ?? '<no filename>'}`;

      console.error(errorMessage);

      if (threadMessage !== undefined) {
        this.postReply(threadMessage, errorMessage);
      } else {
        this.postMessage(errorMessage);
      }

      throw error;
    }
  }

  async updateMessage(message: ChatPostMessageResponse | ChatUpdateResponse, newMessage: string) {
    if (message.ts === undefined) {
      throw new Error('Could not update message.');
    }

    try {
      const response = await this.app.client.chat.update({
        token: this.token,
        channel: message?.channel ?? this.channel,
        ts: message.ts,
        text: newMessage,
      });

      return new SlackMessageThread(this, response);
    } catch (error) {
      if (isCodedError(error)) {
        console.error('Failed to update message with', error.code, newMessage.length);
      }

      this.postReply(message, ['Failed to update Slack message to:', '```', newMessage, '```'].join('\n'));
      throw error;
    }
  }

  async postReply(threadMessage: ChatPostMessageResponse | ChatUpdateResponse, reply: string) {
    if (threadMessage.ts === undefined) {
      throw new Error('Could not reply to message.');
    }

    await this.app.client.chat.postMessage({
      token: this.token,
      channel: threadMessage?.channel ?? this.channel,
      thread_ts: threadMessage.ts,
      text: reply,
    });

    return threadMessage;
  }
}

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
  const tagChannelOnErrorEnvVar = options.tagChannelOnErrorEnvVar ?? 'tag_channel_on_error';
  const tagChannelOnErrorDefault = options.tagChannelOnErrorDefault ?? 'true';

  const token = process.env[tokenEnvVar];
  const channel = process.env[channelEnvVar];
  const secret = process.env[signingSecretEnvVar];
  const tagChannelOnError = process.env[tagChannelOnErrorEnvVar] ?? tagChannelOnErrorDefault;

  if (
    typeof token === 'string' &&
    token.length > 0 &&
    typeof channel === 'string' &&
    channel.length > 0 &&
    typeof secret === 'string' &&
    secret.length > 0
  ) {
    return new SlackClient(token, channel, secret, tagChannelOnError, options.botName, resolveIconUrl(options.iconUrl));
  }

  console.warn(
    `Could not create Slack client. Missing env variables: ${tokenEnvVar}, ${channelEnvVar}, ${signingSecretEnvVar}`,
  );

  return null;
};

export class SlackMessageThread {
  constructor(
    private app: SlackClient,
    private message: ChatPostMessageResponse | ChatUpdateResponse,
  ) {
    /* Empty */
  }

  update = (newMessage: string) => this.app.updateMessage(this.message, newMessage);

  reply = (reply: string) => this.app.postReply(this.message, reply);

  replyFilePath = (filePath: string, reply?: string, title?: string, filename?: string) => {
    // https://github.com/microsoft/playwright/issues/12711
    if (fs.existsSync(filePath)) {
      return this.app.uploadFile(filePath, filename, title, reply, this.message);
    }

    console.error(`Tried to upload file ${filePath ?? ''}, but it did not exist.`);
  };

  replyFileBuffer = (file: Buffer, reply?: string, title?: string, filename?: string) =>
    this.app.uploadFileBuffer(file, filename, title, reply, this.message);
}
