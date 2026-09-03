# Migrating from 1.x to 2.0.0

## 1. Update the package

```sh
bun add @navikt/klage-e2e-reporters@2.0.0
```

## 2. Remove the tag-channel-on-error options

Both options are gone from the Slack reporter. Delete them from the reporter config:

```diff
 slackReporter({
   botName: 'Klang E2E',
   iconUrl: 'navikt/klang/main/frontend/assets/logo192.png',
-  tagChannelOnErrorEnvVar: 'tag_channel_on_error',
-  tagChannelOnErrorDefault: 'false',
 })
```

Leaving them in is a type error.

## 3. Remove the `tag_channel_on_error` environment variable

It is no longer read. Delete it from workflow `env` blocks, `.env` files and any secret or variable that only fed it.

```diff
       - run: bunx playwright test
         env:
           slack_e2e_token: ${{ secrets.SLACK_E2E_TOKEN }}
           slack_signing_secret: ${{ secrets.SLACK_SIGNING_SECRET }}
           klage_notifications_channel: ${{ vars.KLAGE_NOTIFICATIONS_CHANNEL }}
-          tag_channel_on_error: 'true'
```

## 4. Provide the branch, if the run is not on GitHub Actions

The Slack reporter now reads `GITHUB_HEAD_REF`, then `GITHUB_REF_NAME`, then `GITHUB_REF`. On GitHub Actions all of them are set already, and there is nothing to do.

Anywhere else, or where the environment is forwarded explicitly (containers, `env:` allowlists), either set one of those variables or pass the metadata directly:

```ts
slackReporter({
  botName: 'Klang E2E',
  trigger: { repository: 'navikt/klang', branch: 'main', actor: 'someone', version: '1.2.3' },
})
```

Anything not given falls back to the environment, then to `unknown`.
