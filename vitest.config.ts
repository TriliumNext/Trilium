import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
        "packages/*/vitest.config.ts",
        "packages/*/vite.config.ts",
        // ckeditor5 is the one package with both, and its vite.config.ts only builds the library —
        // the tests live in vitest.config.ts. Registering both gives two projects called
        // "@triliumnext/ckeditor5", which vitest rejects.
        "!packages/ckeditor5/vite.config.ts",
        "apps/*/vitest.config.ts",
        "apps/*/vite.config.ts",
        "apps/*/vite.config.mts",
        "scripts/vitest.config.ts",
    ],
  },
})
