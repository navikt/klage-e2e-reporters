/** Slack renders at most ~4000 characters per message. Leave room for formatting. */
export const MAX_MESSAGE_LENGTH = 2_800;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Slack shares at most 10 files (`file_ids`) on a message. */
export const MAX_UPLOADS = 10;
/** `chat.update` is Tier 3: 50+ per minute, shared by every run using the same bot token. */
export const MAIN_UPDATE_INTERVAL = 2_000;
/** Pause between thread messages, to stay within the Slack rate limits. */
export const REPLY_INTERVAL = 500;
export const MAX_DETAILED_STEPS = 15;
export const PROGRESS_WIDTH = 30;
export const MAX_RUNNING_TESTS = 10;
