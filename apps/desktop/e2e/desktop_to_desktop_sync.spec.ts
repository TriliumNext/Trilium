import { _electron as electron, type ElectronApplication, expect, test, type TestInfo } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

declare global {
    interface Window {
        glob: { getHeaders(): Promise<Record<string, string>> };
    }
}

const DIST_PATH =join(__dirname, "../dist/main.mjs");
const A_PORT = 37870;
const B_PORT = 37871;

const launched: { app: ElectronApplication; dataDir: string }[] = [];

test.afterEach(async ({}, testInfo) => {
    for (const { app, dataDir } of launched.splice(0)) {
        await app.close().catch(() => {});
        if (testInfo.status !== testInfo.expectedStatus) {
            await attachLogs(testInfo, dataDir);
        }
        rmSync(dataDir, { recursive: true, force: true });
    }
});

// A picks "Connect a desktop app" and becomes the sync target; B creates a knowledge base and
// points its sync server at A, as the setup wizard instructs.
test("desktop-to-desktop setup opens the main window on the receiving desktop", async () => {
    test.setTimeout(180_000);

    const a = await launchDesktop("a", A_PORT, { allowLanAccess: true });
    const b = await launchDesktop("b", B_PORT, { allowLanAccess: false });

    const aSetup = await a.firstWindow();
    await aSetup.getByRole("button", { name: "Continue" }).click();
    await aSetup.getByText("Connect a desktop app").click();

    const bSetup = await b.firstWindow();
    await bSetup.getByRole("button", { name: "Continue" }).click();
    await bSetup.getByText("New knowledge base").click();
    const bMainPromise = b.waitForEvent("window");
    await bSetup.getByText("Empty").click();
    const bMain = await bMainPromise;
    await expect(bMain).toHaveTitle(/Trilium Notes$/);
    await bMain.waitForFunction(() => typeof window.glob?.getHeaders === "function");

    const aMainPromise = a.waitForEvent("window", { timeout: 90_000 });

    // What the Sync pane's "Test now" button does: save the address, then `sync/test`.
    const testResult = await bMain.evaluate(async (host) => {
        const headers = { ...(await window.glob.getHeaders()), "content-type": "application/json" };
        const save = await fetch("api/options", {
            method: "PUT",
            headers,
            body: JSON.stringify({ syncServerHost: host })
        });
        if (!save.ok) {
            throw new Error(`Saving syncServerHost failed: ${save.status} ${await save.text()}`);
        }
        const res = await fetch("api/sync/test", { method: "POST", headers });
        return await res.json();
    }, `http://127.0.0.1:${A_PORT}`);
    expect(testResult).toMatchObject({ success: true });

    const aMain = await aMainPromise;
    await expect(aMain).toHaveTitle(/Trilium Notes$/);
    await expect.poll(() => aSetup.isClosed()).toBe(true);
});

async function attachLogs(testInfo: TestInfo, dataDir: string) {
    const logDir = join(dataDir, "log");
    if (!existsSync(logDir)) {
        return;
    }
    for (const file of readdirSync(logDir)) {
        await testInfo.attach(`${basename(dataDir)}-${file}`, { path: join(logDir, file), contentType: "text/plain" });
    }
}

async function launchDesktop(name: string, port: number, { allowLanAccess }: { allowLanAccess: boolean }) {
    const dataDir = mkdtempSync(join(tmpdir(), `trilium-d2d-${name}-`));
    writeFileSync(join(dataDir, "security.json"), JSON.stringify({ allowLanAccess }));

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TRILIUM_INTEGRATION_TEST;
    Object.assign(env, {
        TRILIUM_DATA_DIR: dataDir,
        TRILIUM_ELECTRON_DATA_DIR: join(dataDir, "electron"),
        TRILIUM_PORT: String(port),
        ELECTRON_IS_DEV: "0"
    });

    // `ELECTRON_PATH` points at a system Electron where the npm binary cannot run (NixOS), which
    // also lacks a setuid `chrome-sandbox`.
    const executablePath = process.env.ELECTRON_PATH;
    const app = await electron.launch({
        executablePath,
        args: [DIST_PATH, ...(executablePath ? ["--no-sandbox"] : [])],
        env
    });
    launched.push({ app, dataDir });
    return app;
}
