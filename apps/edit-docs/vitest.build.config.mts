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
    include: ['spec/build-checks/**'],
    reporters: [
      "verbose"
    ]
  },
}));
