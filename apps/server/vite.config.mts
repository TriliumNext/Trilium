/// <reference types='vitest' />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    setupFiles: ["./spec/setup.ts"],
    environment: "node",
    env: {
      NODE_ENV: "development",
      TRILIUM_DATA_DIR: "./spec/db",
      TRILIUM_INTEGRATION_TEST: "memory",
      // Must be set in the vitest env (not in spec/setup.ts) so import-time
      // constants like `isDev` in apps/server/src/services/utils.ts evaluate
      // correctly. setup.ts top-level statements run AFTER its static imports
      // resolve, so any env var assigned there is too late for module-load
      // constants in transitively-imported files.
      TRILIUM_ENV: "dev",
      TRILIUM_PUBLIC_SERVER: "http://localhost:4200"
    },
    include: [
      '{src,spec}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../packages/trilium-core/src/**/*.{test,spec}.{ts,tsx}'
    ],
    exclude: [
      "spec/build-checks/**",
    ],
    hookTimeout: 20_000,
    testTimeout: 40_000,
    // Write worker console output straight to stdout instead of forwarding each call to the main
    // process over the worker RPC. With the interception on, the suite intermittently failed with
    // every test passing:
    //
    //   EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending
    //
    // `buildApp()` — called by ~60 spec files — starts the server's background jobs, which schedule
    // work for +4s (consistency checks), +5s (sync) and +10s (backendStartup scripts) and chain off
    // `sqlInit.dbReady`. Each runs through `cls.wrap`, whose catch logs with a raw `console.log`, so
    // a file whose tests end inside that window tears its worker down with log output still in
    // flight and the run exits 1 regardless of the results. Suppressing individual log sources only
    // narrows the window (see log_provider.ts); removing the RPC hop removes the failure mode.
    // Cost: log lines are no longer prefixed with the originating test, nor captured by the HTML and
    // JUnit reporters.
    disableConsoleIntercept: true,
    reporters: [
      "verbose",
      ["html", { outputFile: "./test-output/vitest/html/index.html" }],
      ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
    ],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      // Codecov resolves an lcov `SF:` path by matching it against the repo's file list. Vitest
      // defaults the lcov reporter's `projectRoot` to the Vite `root`, which would emit paths
      // relative to this app (`src/…`, `../../packages/trilium-core/src/…`); the shallow ones are
      // ambiguous in this monorepo and get attributed to whichever project wins the match. Anchor
      // to the repo root so every path is unambiguous.
      reporter: [ "text", "html", ["lcov", { projectRoot: resolve(__dirname, '../..') }] ],
      allowExternal: true,
      include: ["src/**/*.{ts,tsx}", "../../packages/trilium-core/src/**/*.{ts,tsx}"],
      exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"]
    },
    pool: "forks",
    maxWorkers: 6
  },
}));
