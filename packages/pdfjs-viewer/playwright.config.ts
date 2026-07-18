import { defineConfig, devices } from "@playwright/test";

const port = process.env.PDFJS_E2E_PORT ?? "8935";
const baseURL = `http://127.0.0.1:${port}`;

/**
 * E2E tests for the viewer itself, run against the built bundle served statically
 * together with a stub of the Trilium client (see e2e/harness). No Trilium server
 * is involved; the tests speak the same postMessage protocol as the client.
 */
export default defineConfig({
    testDir: "./e2e",
    outputDir: "./test-output/playwright",
    reporter: [["list"], ["html", { outputFolder: "./test-output/playwright-report", open: "never" }]],
    retries: process.env.CI ? 2 : 0,
    timeout: 60_000,
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        baseURL,
        trace: "on-first-retry",
        // Set PLAYWRIGHT_CHROME_CHANNEL=chrome to run against a system Chrome
        // instead of the Playwright-managed Chromium.
        channel: process.env.PLAYWRIGHT_CHROME_CHANNEL
    },
    webServer: {
        command: "pnpm build && node e2e/harness/serve.mjs",
        url: `${baseURL}/parent.html`,
        reuseExistingServer: !process.env.CI,
        env: { PDFJS_E2E_PORT: port },
        timeout: 120_000
    }
});
