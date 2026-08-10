import { resolve } from "node:path";

import { webdriverio } from "@vitest/browser-webdriverio";
import { defineConfig } from "vitest/config";

/**
 * The browser to drive, when the one webdriverio would fetch for itself cannot run — on NixOS the
 * downloaded Chrome for Testing dies on a missing `libxcb.so.1`, since nothing outside the store
 * provides it. Point `CHROME_BIN` at a system Chrome/Chromium and webdriverio skips the download
 * altogether; pair it with `CHROMEDRIVER_PATH` (webdriverio's own variable) for the driver, which
 * has the same problem. The Nix dev shell sets both.
 */
const systemChrome = process.env.CHROME_BIN;

export default defineConfig({
    test: {
        browser: {
            enabled: true,
            provider: webdriverio(systemChrome
                ? { capabilities: { browserName: "chrome", "goog:chromeOptions": { binary: systemChrome } } }
                : {}),
            headless: true,
            ui: false,
            instances: [{ browser: "chrome" }]
        },
        include: ["src/**/*.spec.ts"],
        setupFiles: ["./test/setup.ts"],
        globals: true,
        watch: false,
        reporters: ["default", ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]],
        coverage: {
            // 99.5 rather than 100: the suite is effectively fully covered, and the small
            // remainder is unreachable defensive code that is cheaper to leave uncovered than to
            // keep annotating. Raise it back if that residue is ever closed.
            thresholds: {
                lines: 99.5,
                functions: 99.5,
                branches: 99.5,
                statements: 99.5
            },
            provider: "v8",
            reportsDirectory: "./test-output/vitest/coverage",
            // Restrict to this package's own sources. The aggregate imports the sibling
            // @triliumnext/ckeditor5-* workspace packages, whose `src/` would otherwise bleed
            // into this report; they carry their own 100% coverage gates in their own packages.
            allowExternal: false,
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts", "**/node_modules/**", "**/ckeditor5-*/**"],
            // Codecov resolves an lcov `SF:` path by matching it against the repo's file list, so
            // the package-relative paths istanbul emits by default (`src/utils.ts`, relative to
            // cwd) are ambiguous in this monorepo and get attributed to whichever package wins the
            // match. Emit repo-root-relative paths instead.
            reporter: ["text", ["lcov", { projectRoot: resolve(__dirname, "../..") }]]
        }
    }
});
