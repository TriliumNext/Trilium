import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { type Browser, chromium, type Page } from "playwright";

import { repoRoot } from "../shared/build.ts";

export interface DesktopApp {
    /** The main window. */
    page: Page;
    stop(): Promise<void>;
}

/**
 * Starts the desktop app in dev mode on `dataDir`, in the session that `env` describes, and
 * resolves with its main window as a Playwright page, reached over the remote debugging port.
 */
export async function startDesktopApp({ dataDir, env, debugPort, port, logPath }: {
    dataDir: string;
    env: NodeJS.ProcessEnv;
    debugPort: number;
    port: number;
    logPath: string;
}): Promise<DesktopApp> {
    const electronDataDir = fs.mkdtempSync(path.join(dataDir, "electron-"));
    const appEnv: NodeJS.ProcessEnv = {
        ...env,
        TRILIUM_PORT: String(port),
        TRILIUM_DATA_DIR: dataDir,
        TRILIUM_ELECTRON_DATA_DIR: electronDataDir
    };
    // Set by editors that are themselves Electron apps; Electron would then start as Node.
    delete appEnv.ELECTRON_RUN_AS_NODE;
    delete appEnv.ELECTRON_NO_ATTACH_CONSOLE;

    const log = fs.openSync(logPath, "w");
    const app = spawn(process.execPath, [
        "--import", "tsx", "../../scripts/electron-start.mts", "src/main.ts",
        `--remote-debugging-port=${debugPort}`
    ], {
        cwd: path.join(repoRoot, "apps", "desktop"),
        env: appEnv,
        detached: true,
        stdio: [ "ignore", log, log ]
    });
    let exited = false;
    app.on("exit", () => { exited = true; });

    const stop = () => {
        try {
            if (app.pid) process.kill(-app.pid);
        } catch {
            // Already gone.
        }
    };
    process.on("exit", stop);

    const deadline = Date.now() + 3 * 60_000;
    let browser: Browser | undefined;
    let page: Page | undefined;
    while (!page) {
        if (exited || Date.now() > deadline) {
            stop();
            throw new Error(`The desktop app did not start; see ${logPath}.`);
        }
        try {
            browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
            page = browser.contexts().flatMap((context) => context.pages())
                .find((candidate) => candidate.url().startsWith("trilium-app:"));
        } catch {
            // The debugging port is not open yet.
        }
        if (!page) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await page.waitForFunction(
        () => window.glob?.appContext?.tabManager?.getActiveContext(),
        null,
        { timeout: 120_000 }
    );

    return {
        page,
        async stop() {
            await browser?.close().catch(() => {});
            stop();
        }
    };
}
