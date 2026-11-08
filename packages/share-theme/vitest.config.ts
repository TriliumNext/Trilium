import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        {
            // Stands in for the client build's `virtual:code-themes.css`, which `index.ts` imports.
            name: "code-themes",
            resolveId: (id) => (id === "virtual:code-themes.css" ? `\0${id}` : null),
            load: (id) => (id === "\0virtual:code-themes.css" ? "" : null)
        }
    ],
    oxc: {
        jsx: { runtime: "automatic", importSource: "preact" }
    },
    test: {
        include: [ "src/**/*.spec.{ts,tsx}" ],
        environmentOptions: {
            happyDOM: {
                settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true }
            }
        },
        reporters: [
            "default",
            [ "junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true } ]
        ],
        coverage: {
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100
            },
            reportsDirectory: "./test-output/vitest/coverage",
            provider: "v8",
            include: [ "src/**/*.{ts,tsx}" ],
            exclude: [ "src/**/*.spec.{ts,tsx}", "src/**/*.d.ts" ],
            // Codecov matches an lcov `SF:` path against the files of the whole repository, where a
            // package-relative `src/index.ts` is ambiguous.
            reporter: [ "text", "html", [ "lcov", { projectRoot: resolve(__dirname, "../..") } ] ]
        }
    }
});
