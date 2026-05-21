import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  sourcemap: true,
  clean: true,
  format: ['esm', 'cjs'],
  entry: ['src/index.ts', 'src/slack-reporter.ts', 'src/status-reporter.ts'],
  platform: 'node',
  deps: {
    neverBundle: [/^@slack\//, /^@playwright\//],
  },
});
