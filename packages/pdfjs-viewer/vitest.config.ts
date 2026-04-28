import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/pdfjs-viewer',
    plugins: [],
    test: {
        'watch': false,
        'globals': true,
        'environment': "node",
        'include': ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        'reporters': ["default"],
        'coverage': {
            'reportsDirectory': './test-output/vitest/coverage',
            'provider': 'v8' as const,
        }
    },
}));
