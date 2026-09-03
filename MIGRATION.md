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

## 4. Provide the branch

The Slack reporter now shows the branch, read from `GITHUB_REF_NAME`. Nothing is inherited where these tests
run, so set it wherever the rest of the metadata is set. In a Naisjob manifest that is another `env` entry:

```diff
     - name: GITHUB_REPOSITORY
       value: '{{github_repository}}'
+    - name: GITHUB_REF_NAME
+      value: '{{github_ref_name}}'
```

fed by the workflow that deploys it, which is the only place that knows the event the run came from:

```diff
-          VAR: ...,github_repository=${{ github.repository }}
+          VAR: ...,github_repository=${{ github.repository }},github_ref_name=${{ github.head_ref || github.ref_name }}
```

`github.head_ref` is the source branch of a pull request and empty on every other event, so `github.ref_name`
answers for a push, a manual run and everything else. Both changes have to land together: a placeholder with no
matching `VAR` entry is not substituted.

The metadata can be passed to the reporter directly instead:

```ts
slackReporter({
  botName: 'Klang E2E',
  trigger: { repository: 'navikt/klang', branch: 'main', actor: 'someone', version: '1.2.3' },
})
```

Anything not given, or given as an empty string, falls back to the environment, then to `unknown`. Whatever ends
up as `unknown` is named in a warning on stderr, in the log of the run itself.
