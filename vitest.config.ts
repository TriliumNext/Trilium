import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
        "packages/*/vitest.config.ts",
        "packages/*/vite.config.ts",
        "apps/*/vitest.config.ts",
        "apps/*/vite.config.ts",
        "apps/*/vite.config.mts",
    ],
  },
})
