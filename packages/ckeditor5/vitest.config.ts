import { resolve } from "node:path";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * The browser to drive, when the one Playwright downloads for itself cannot run — on NixOS the
 * bundled Chromium dies on a missing `libxcb.so.1`, since nothing outside the store provides it.
 * Point `CHROME_BIN` at a system Chrome/Chromium and Playwright launches that instead. The Nix dev
 * shell sets it.
 */
const systemChrome = process.env.CHROME_BIN;

export default defineConfig({
    test: {
        browser: {
            enabled: true,
            provider: playwright({
                // Specs assert en-US number formatting (`toLocaleString()` renders 1,234 there and
                // 1.234 under a European locale), so the host machine's locale must not decide.
                contextOptions: { locale: "en-US" },
                ...(systemChrome ? { launchOptions: { executablePath: systemChrome } } : {})
            }),
            headless: true,
            ui: false,
            instances: [{ browser: "chromium" }]
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
