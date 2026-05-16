/// <reference types='vitest' />
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
    reporters: [
      "verbose",
      ["html", { outputFile: "./test-output/vitest/html/index.html" }]
    ],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      reporter: [ "text", "html" ]
    },
    pool: "forks",
    maxWorkers: 6
  },
}));
