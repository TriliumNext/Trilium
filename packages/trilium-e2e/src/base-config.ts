import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { join } from "path";

interface BaseConfigOptions {
    /**
     * The directory of the calling app (i.e. `__dirname` from the app's playwright.config.ts).
     */
    appDir: string;

    /**
     * Optional local test directory for app-specific tests (relative to appDir).
     * If provided, a second project is added for app-specific tests.
     */
    localTestDir?: string;

    /**
     * The name for the app-specific test project (e.g. "server", "standalone").
     */
    projectName: string;

    /**
     * Optional webServer configuration to start the app before tests.
     */
    webServer?: PlaywrightTestConfig["webServer"];

    /**
     * Number of parallel workers. Defaults to Playwright's default (half of CPU cores).
     */
    workers?: number;
}

/**
 * Creates a base Playwright configuration that includes the shared trilium-e2e
 * tests and optionally app-specific tests.
 */
export function createBaseConfig({ appDir, localTestDir, projectName, webServer, workers }: BaseConfigOptions) {
    const port = process.env["TRILIUM_PORT"] ?? "8082";
    const baseURL = process.env["BASE_URL"] || `http://127.0.0.1:${port}`;
    const sharedTestDir = join(__dirname);

    const projects: PlaywrightTestConfig["projects"] = [
        {
            name: `${projectName}-shared`,
            testDir: sharedTestDir,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: `${projectName}-shared-firefox`,
            testDir: sharedTestDir,
            use: { ...devices["Desktop Firefox"] },
        },
    ];

    if (localTestDir) {
        projects.push({
            name: projectName,
            testDir: join(appDir, localTestDir),
            use: { ...devices["Desktop Chrome"] },
        });
    }

    return defineConfig({
        // outputDir (raw per-test artifacts written during the run: videos, traces, screenshots)
        // must NOT be the same path as the html reporter's outputFolder below. The html reporter
        // clears its output folder before copying attachments into it, so pointing both at the
        // same directory wiped the video/trace files out from under it before they could be
        // embedded — every report ended up with zero playable video/trace data, silently.
        reporter: [["list"], ["html", { outputFolder: join(appDir, "test-output") }]],
        outputDir: join(appDir, "test-results"),
        retries: 3,
        use: {
            baseURL,
            trace: "on-first-retry",
        },
        workers,
        webServer,
        projects,
    });
}
