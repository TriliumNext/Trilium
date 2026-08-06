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
            thresholds: {
                lines: 99,
                functions: 100,
                branches: 98,
                statements: 99
            },
            reportsDirectory: "./test-output/vitest/coverage",
            provider: "v8" as const,
            include: [ "src/**/*.ts" ],
            exclude: [ "**/*.spec.ts", "**/*.d.ts", "src/index.ts", "src/test-helpers.ts" ],
            reporter: [ "text", [ "lcov", { projectRoot: resolve(__dirname, "../..") } ] ]
        }
    }
}));
