/**
 * Native shell: trilium-core runs in a Deno process with native SQLite
 * (node:sqlite), Deno providers, and the shared route table; the webview
 * hosts only the client. See server/core_server.ts for the provider
 * assembly.
 *
 * The core server runs as a child `deno run` process rather than inside
 * this compiled shell: the experimental desktop runtime currently hangs
 * when loading npm modules at runtime (both embedded and from disk), while
 * a plain `deno run` of the same graph works. Once that upstream bug is
 * fixed, server/dev.ts can be imported here directly and the child process
 * disappears.
 */

import {
    driveSetup,
    registerBindings,
    resolveDataDir,
    resolveDistDir,
    setupTray,
    unwrapExecuteJs
} from "./shell_common.ts";

const SMOKE_MODE = Deno.env.get("TRILIUM_SMOKE") === "1";

const distDir = resolveDistDir();
// Smoke runs drive the real setup flow, so give them a throwaway database.
const dataDir = SMOKE_MODE
    ? Deno.makeTempDirSync({ prefix: "trilium-deno-smoke-" })
    : resolveDataDir();

const appDir = resolveAppDir();
const port = 20000 + Math.floor(Math.random() * 20000);
const serverUrl = `http://127.0.0.1:${port}`;

console.log(`[native] starting core server (data=${dataDir})`);
const child = spawnCoreServer();
await waitForServer();
console.log(`[native] core server ready at ${serverUrl}`);

const win = new Deno.BrowserWindow({
    title: "Trilium Notes",
    width: 1280,
    height: 850
});
win.navigate(serverUrl);

registerBindings(win);
const tray = setupTray(win, distDir);

win.addEventListener("close", () => {
    tray?.destroy();
    try {
        child.kill();
    } catch {
        // Already gone.
    }
    Deno.exit(0);
});

if (SMOKE_MODE) {
    await runSmokeCheck(win);
}

/** Locates the app directory (containing server/) next to this module or the bundle. */
function resolveAppDir(): string {
    const candidates = [
        Deno.env.get("TRILIUM_APP_DIR"),
        import.meta.dirname,
        Deno.cwd(),
        // The bundled binary runs from apps/desktop-deno/<bundle>/.
        `${Deno.cwd()}/..`
    ];
    for (const dir of candidates) {
        if (!dir) {
            continue;
        }
        try {
            Deno.statSync(`${dir}/server/core_server.ts`);
            return dir;
        } catch {
            // Try the next candidate.
        }
    }
    console.error(
        "Could not locate server/core_server.ts. Run from the repo (apps/desktop-deno)\n" +
        "or point TRILIUM_APP_DIR at the app directory."
    );
    Deno.exit(1);
}

function spawnCoreServer(): Deno.ChildProcess {
    const denoBin = Deno.env.get("DENO_BIN") ?? "deno";
    const process = new Deno.Command(denoBin, {
        args: ["run", "--no-check", "-A", `${appDir}/server/dev.ts`],
        cwd: appDir,
        env: {
            PORT: String(port),
            // Deno.serve prefers DENO_SERVE_ADDRESS over the port option, and
            // the child would otherwise inherit the desktop runtime's value.
            DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
            TRILIUM_DATA_DIR: dataDir
        },
        stdout: "inherit",
        stderr: "inherit"
    }).spawn();

    process.status.then((status) => {
        console.error(`[native] core server exited with code ${status.code}`);
        Deno.exit(status.code === 0 ? 0 : 1);
    });
    return process;
}

async function waitForServer() {
    const deadlineAt = Date.now() + 60_000;
    while (Date.now() < deadlineAt) {
        try {
            const res = await fetch(`${serverUrl}/api/app-info`, { signal: AbortSignal.timeout(2_000) });
            if (res.ok) {
                await res.body?.cancel();
                return;
            }
            await res.body?.cancel();
        } catch {
            // Not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.error("Core server did not become ready within 60s.");
    Deno.exit(1);
}

/**
 * Native-mode smoke: waits for the client to boot against the core server
 * (fresh database → setup wizard), drives the real setup, reloads, and
 * requires the full app UI plus a live entity-change WebSocket.
 */
async function runSmokeCheck(win: Deno.BrowserWindow) {
    const readState = async () => {
        const raw = unwrapExecuteJs(await win.executeJs(`(() => JSON.stringify({
            url: location.href,
            readyState: document.readyState,
            title: document.title,
            glob: typeof window.glob !== "undefined",
            launcher: !!document.querySelector("#launcher-pane"),
            bodyChildren: document.body ? document.body.children.length : 0,
            bodyPreview: document.body ? document.body.innerText.trim().slice(0, 120) : ""
        }))()`));
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, any>;
    };

    const waitFor = async (label: string, predicate: (s: Record<string, any>) => boolean, timeoutMs: number) => {
        const deadlineAt = Date.now() + timeoutMs;
        let lastState: unknown = null;
        while (Date.now() < deadlineAt) {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            try {
                const state = await readState();
                lastState = state;
                console.log(`[smoke:${label}]`, JSON.stringify(state));
                if (predicate(state)) {
                    return;
                }
            } catch (e) {
                lastState = String(e);
                console.log(`[smoke:${label}] executeJs failed:`, lastState);
            }
        }
        console.error(`SMOKE_TIMEOUT at ${label}`, JSON.stringify(lastState));
        Deno.exit(1);
    };

    // 1. Client boots against the native core → setup wizard (fresh DB).
    await waitFor("boot", (s) => s.readyState === "complete" && s.glob && s.bodyChildren >= 1, 90_000);
    console.log("SMOKE_UI_OK");

    // 2. Real setup: schema + demo document through node:sqlite.
    const setupStatus = await driveSetup(win);
    console.log(`SMOKE_SETUP_DONE status=${setupStatus}`);
    if (setupStatus !== "200") {
        Deno.exit(1);
    }

    // 3. Full app after reload, including the entity-change WebSocket
    //    (the client reconnects on a timer, so give it a grace period).
    win.reload();
    await waitFor("app", (s) => s.glob && s.launcher, 90_000);
    let status = { apiRequests: 0, wsClients: 0 };
    const wsDeadlineAt = Date.now() + 45_000;
    while (Date.now() < wsDeadlineAt) {
        status = await (await fetch(`${serverUrl}/desktop-status`)).json();
        if (status.wsClients >= 1) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    const dbSize = (await Deno.stat(`${dataDir}/document.db`)).size;
    console.log(
        `SMOKE_NATIVE_OK apiRequests=${status.apiRequests}, wsClients=${status.wsClients}, db=${dbSize} bytes`
    );
    Deno.exit(status.wsClients >= 1 ? 0 : 1);
}
