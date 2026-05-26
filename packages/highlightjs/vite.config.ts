
import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/highlightjs',
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
            name: 'highlightjs',
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
        'watch': false,
        'globals': true,
        'environment': "happy-dom",
        'include': ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        'reporters': ["default"],
        'coverage': {
            'reportsDirectory': './test-output/vitest/coverage',
            'provider': 'v8' as const,
        }
    },
}));
