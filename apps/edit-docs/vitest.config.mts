/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/edit-docs',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    environment: "node",
    include: ['src/**/*.spec.ts'],
    reporters: [
      "verbose"
    ],
    coverage: {
      provider: "v8" as const,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "./test-output/vitest/coverage"
    }
  },
}));
