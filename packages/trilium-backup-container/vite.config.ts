/// <reference types='vitest' />
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: "../../node_modules/.vite/packages/trilium-backup-container",
    plugins: [],
    test: {
        watch: false,
        globals: true,
        environment: "node",
        include: [ "src/**/*.{test,spec}.ts" ],
        reporters: [
            "default",
            [ "junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true } ]
        ],
        coverage: {
            // Every line, and every branch that any input can reach. What no input reaches carries
            // a `v8 ignore` naming the caller that makes it unreachable, so the exceptions are
            // read and argued rather than absorbed into a percentage.
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100
            },
            reportsDirectory: "./test-output/vitest/coverage",
            provider: "v8" as const,
            include: [ "src/**/*.ts" ],
            exclude: [
                "**/*.spec.ts",
                "**/*.d.ts",
                "src/index.ts",
                "src/web.ts",
                "src/test-helpers.ts"
            ],
            reporter: [ "text", [ "lcov", { projectRoot: resolve(__dirname, "../..") } ] ]
        }
    }
}));
