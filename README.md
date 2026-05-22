# @navikt/klage-e2e-reporters

Shared Playwright reporters for Klage E2E test suites. Provides Slack notifications and job status reporting.

## Install

```toml
# bunfig.toml
[install.scopes]
"@navikt" = { url = "https://npm.pkg.github.com", token = "$READER_TOKEN" }
```

```sh
bun add @navikt/klage-e2e-reporters
```

## Usage

```ts
import { slackReporter, statusReporter } from '@navikt/klage-e2e-reporters';
import { defineConfig } from 'playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    slackReporter({ botName: 'Klang E2E', iconUrl: 'navikt/klang/main/frontend/assets/logo192.png' }),
    statusReporter({ name: 'Klang E2E' }),
  ],
});
```

## Reporters

### Slack Reporter

Posts test results to a Slack channel with per-test threads, step details, and video/trace uploads on failure.

#### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `botName` | Yes | | Bot display name in Slack |
| `iconUrl` | No | | Bot icon URL or GitHub raw path |
| `tokenEnvVar` | No | `slack_e2e_token` | Env var for Slack bot token |
| `channelEnvVar` | No | `klage_notifications_channel` | Env var for Slack channel |
| `signingSecretEnvVar` | No | `slack_signing_secret` | Env var for Slack signing secret |
| `tagChannelOnErrorEnvVar` | No | `tag_channel_on_error` | Env var for tag-channel-on-error flag |
| `tagChannelOnErrorDefault` | No | `true` | Default value for tag-channel-on-error |

### Status Reporter

Reports job status to the [klage-job-status](https://github.com/navikt/klage-job-status) API.

#### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | Yes | | Display name for the job |
| `baseUrl` | No | `https://klage-job-status.ekstern.dev.nav.no` | Base URL for the status API |
| `timeout` | No | `900` | Timeout in seconds |
| `apiKeyEnvVar` | No | `WRITE_API_KEY` | Env var for the write API key |
| `jobIdEnvVar` | No | `JOB_ID` | Env var for the job ID |

## Environment Variables

The reporters read credentials from environment variables (configurable via options above):

| Variable | Used by | Description |
| --- | --- | --- |
| `slack_e2e_token` | Slack | Bot OAuth token |
| `slack_signing_secret` | Slack | App signing secret |
| `klage_notifications_channel` | Slack | Channel ID to post to |
| `tag_channel_on_error` | Slack | Whether to @channel on failures |
| `WRITE_API_KEY` | Status | API key for klage-job-status |
| `JOB_ID` | Status | Unique job identifier |
| `VERSION` | Both | App version shown in messages |
| `GITHUB_ACTOR` | Both | GitHub user who triggered the run |
| `GITHUB_REPOSITORY` | Both | Repository name |

## Subpath Exports

The package provides subpath exports for direct use in Playwright's tuple syntax:

- `@navikt/klage-e2e-reporters` - Helper functions and re-exports
- `@navikt/klage-e2e-reporters/slack` - Slack reporter class
- `@navikt/klage-e2e-reporters/status` - Status reporter class

## Development

```sh
bun install
bun run build
bun run lint
bun run typecheck
```
