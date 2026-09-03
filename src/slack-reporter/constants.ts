/** Slack renders at most ~4000 characters per message. Leave room for formatting. */
export const MAX_MESSAGE_LENGTH = 2_800;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** `chat.update` is Tier 3: 50+ per minute, shared by every run using the same bot token. */
export const MAIN_UPDATE_INTERVAL = 2_000;
/** `chat.postMessage` allows about one message per second per channel, and the whole report shares one. */
export const REPLY_INTERVAL = 1_000;
export const MAX_DETAILED_STEPS = 15;
/** An error block earns its place only when more than the truncation marker fits: `error.txt` holds them all. */
export const MIN_ERROR_LENGTH = 200;
export const PROGRESS_WIDTH = 30;
export const MAX_RUNNING_TESTS = 10;
/** Project names, file paths and run metadata are free text, so they are cut before they can crowd out a message. */
export const MAX_FIELD_LENGTH = 100;
