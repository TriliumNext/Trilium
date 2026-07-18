
import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/commons',
    plugins: [],
    test: {
        'watch': false,
        'globals': true,
        'environment': "node",
        'include': ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        'reporters': [
            "default",
            ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
        ],
        'coverage': {
            'reportsDirectory': './test-output/vitest/coverage',
            'provider': 'v8' as const,
            'reporter': ['text', 'html', 'lcov'],
            'include': ['src/**/*.ts'],
            'exclude': ['src/**/*.spec.ts'],
        }
    },
}));
