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
      TRILIUM_INTEGRATION_TEST: "memory"
    },
    include: ['{src,spec}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      "spec/build-checks/**",
    ],
    hookTimeout: 20000,
    reporters: [
      "verbose"
    ],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      reporter: [ "text", "html" ]
    },
    pool: "vmForks"
  },
}));
