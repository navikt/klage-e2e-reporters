import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  sourcemap: true,
  clean: true,
  format: 'esm',
  // Keeps the built file names stable now that the Slack reporter is a folder.
  entry: {
    index: 'src/index.ts',
    'slack-reporter': 'src/slack-reporter/index.ts',
    'status-reporter': 'src/status-reporter.ts',
  },
  platform: 'node',
  deps: {
    neverBundle: [/^@slack\//, /^@playwright\//],
  },
});
