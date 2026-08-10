
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/codemirror',
  plugins: [],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      // Could also be a dictionary or array of multiple entry points.
      entry: 'src/index.ts',
      name: 'codemirror',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es' as const]
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      external: []
    },
  },
  test: {
    watch: false,
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: [
      'default',
      ['junit', { outputFile: './test-output/vitest/junit.xml', addFileAttribute: true }]
    ],
    coverage: {
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      },
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts'],
      // Codecov resolves an lcov `SF:` path by matching it against the repo's file list, so the
      // package-relative paths istanbul emits by default (`src/index.ts`, relative to cwd) are
      // ambiguous in this monorepo and get attributed to whichever package wins the match. Emit
      // repo-root-relative paths instead.
      reporter: ['text', ['lcov', { projectRoot: resolve(__dirname, '../..') }]],
      reportsDirectory: './test-output/vitest/coverage'
    }
  },
}));
