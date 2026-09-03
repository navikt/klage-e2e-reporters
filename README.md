# @navikt/klage-e2e-reporters

Shared Playwright reporters for Klage E2E test suites: Slack notifications and job status reporting.

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

Posts a single summary message to a Slack channel, updated while the run is in progress, and keeps the details
in its thread. A colored bar along the left edge shows the status: blue while running, green when everything
passed and red when something failed.

#### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `botName` | Yes | | Bot display name in Slack |
| `iconUrl` | No | | Bot icon URL or GitHub raw path |
| `tokenEnvVar` | No | `slack_e2e_token` | Env var for Slack bot token |
| `channelEnvVar` | No | `klage_notifications_channel` | Env var for Slack channel |
| `signingSecretEnvVar` | No | `slack_signing_secret` | Env var for Slack signing secret |
| `slowTestThreshold` | No | `60000` | Tests slower than this (ms) are listed as slow |
| `slowStepThreshold` | No | `15000` | Steps slower than this (ms) are listed as slow |
| `maxSlowEntries` | No | `10` | Max entries in each slow list |
| `maxFailureDetails` | No | `25` | Max failing tests that get their own detailed message |

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

Credentials and run metadata, read from the environment. The variables with an option can be renamed through it,
and the names below are their defaults. The `GITHUB_*` variables are the ones GitHub Actions sets, and are read
under those names only.

| Variable | Used by | Option | Description |
| --- | --- | --- | --- |
| `slack_e2e_token` | Slack | `tokenEnvVar` | Bot OAuth token |
| `slack_signing_secret` | Slack | `signingSecretEnvVar` | App signing secret |
| `klage_notifications_channel` | Slack | `channelEnvVar` | Channel ID to post to |
| `WRITE_API_KEY` | Status | `apiKeyEnvVar` | API key for klage-job-status |
| `JOB_ID` | Status | `jobIdEnvVar` | Unique job identifier |
| `VERSION` | Both | | App version shown in messages |
| `GITHUB_ACTOR` | Both | | GitHub user who triggered the run |
| `GITHUB_REPOSITORY` | Both | | Repository name |
| `GITHUB_HEAD_REF` / `GITHUB_REF_NAME` / `GITHUB_REF` | Slack | | Branch shown in the trigger metadata |

## Subpath Exports

For direct use in Playwright's tuple syntax:

- `@navikt/klage-e2e-reporters` - Helper functions and re-exports
- `@navikt/klage-e2e-reporters/slack` - Slack reporter class
- `@navikt/klage-e2e-reporters/status` - Status reporter class

## Development

```sh
bun install
bun run build
bun run lint
bun run typecheck
bun run test
```

`bun run test` runs the unit tests, which is what CI runs. The Slack report itself is checked by hand, with the
script below.

### Checking the Slack report by hand

`bun run report:slack` posts two fake runs to Slack, so the layout of the report can be verified by hand:

- a failed run with passed, slow, failed, flaky and skipped tests, including screenshots, video, trace, stdout
  and stack traces
- a successful run where everything passes on the first attempt

It takes well under a minute: every step is played out in a fixed second, rather than the duration the fake test
reports, which is long enough for the main message to be updated a few times while a run is in progress. The
script fails if the reporter logs an error. It needs the Slack credentials, which Bun loads from `.env`
automatically:

```sh
# .env (git ignored)
slack_e2e_token=xoxb-...
slack_signing_secret=...
klage_notifications_channel=C0123456789
```

#### Cleaning up the test reports

`src/slack-reporter/test/cleanup.ts` deletes the reports the script posted, and leaves everything else in the
channel alone. A thread is only deleted when its main message was posted by the test bot and names this
repository, `navikt/klage-e2e-reporters`, which nothing but the fake runs does. The whole thread goes with it:
replies, uploaded files and the messages sharing them. Anything that only partly matches is listed as kept.

```sh
bun run clean:slack            # lists what would be deleted, from the last three days
bun run clean:slack --days=7   # a different window
bun run clean:slack --delete   # deletes it
```

It reads the same credentials as the report script, and the bot token needs these scopes:

| Scope | Used for |
| --- | --- |
| `channels:history` (`groups:history` in a private channel) | Finding the reports |
| `chat:write` | Deleting the messages |
| `files:write` | Deleting the uploaded files |
