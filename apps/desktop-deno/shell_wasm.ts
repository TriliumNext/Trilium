/**
 * Trilium Notes — Deno Desktop prototype.
 *
 * Wraps the standalone (SQLite WASM + service worker) build of Trilium in a
 * native window using `deno desktop` (experimental since Deno 2.9). The
 * entire stack runs exactly like the standalone web app: this entrypoint only
 * serves the prebuilt static bundle on the loopback address that the webview
 * navigates to, and adds a few native integrations (tray, notifications,
 * dock badge) through the in-process binding bridge.
 *
 * Run with: deno task start (see README.md for prerequisites)
 */

import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { serveDir } from "@std/http/file-server";
import { DatabaseSync } from "node:sqlite";

type StatementSync = ReturnType<DatabaseSync["prepare"]>;

const SMOKE_MODE = Deno.env.get("TRILIUM_SMOKE") === "1";

const distDir = resolveDistDir();
// Smoke runs drive the real setup flow, so give them a throwaway database.
const dataDir = SMOKE_MODE
    ? Deno.makeTempDirSync({ prefix: "trilium-deno-smoke-" })
    : resolveDataDir();
const dbPath = `${dataDir}/document.db`;
// Legacy snapshot bridge writes go to a separate file so they can never
// clobber the natively opened database.
const snapshotPath = `${dataDir}/document-snapshot.db`;
let dbSaveAttempts = 0;
let sqlOps = 0;

// Native SQLite database backing the SQL bridge (see handleSqlRoute). The
// standalone worker executes all of its SQL against this file, so the user's
// notes live directly on the host filesystem.
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
const statementCache = new Map<string, StatementSync>();

// `Deno.serve()` binds to the address chosen by the desktop runtime
// (DENO_SERVE_ADDRESS); the webview navigates to it automatically.
Deno.serve(async (req) => {
    const { pathname } = new URL(req.url);

    // SQL bridge: the standalone worker probes this endpoint and, if present,
    // executes all SQL against the native database above instead of WASM
    // SQLite (see apps/standalone/src/lightweight/bridged_sql_provider.ts).
    if (pathname === "/desktop-sql") {
        return handleSqlRoute(req);
    }

    // Legacy snapshot bridge (see desktop_persistence.ts): unused when the
    // SQL bridge is available, kept as a fallback for older bundles.
    if (pathname === "/desktop-db") {
        return handleDatabaseRoute(req);
    }

    const res = await serveDir(req, { fsRoot: distDir, quiet: true });

    // SPA fallback: any navigation-ish request that misses a file gets the
    // app shell, mirroring how the standalone build is hosted in production.
    if (res.status === 404 && req.method === "GET" && wantsHtml(req)) {
        const index = await Deno.readFile(`${distDir}/index.html`);
        return withSecurityHeaders(
            new Response(index, { headers: { "content-type": "text/html" } })
        );
    }

    return withSecurityHeaders(new Response(res.body, res));
});

const win = new Deno.BrowserWindow({
    title: "Trilium Notes",
    width: 1280,
    height: 850
});

registerBindings(win);
const tray = setupTray(win);

win.addEventListener("close", () => {
    tray?.destroy();
    Deno.exit(0);
});

if (SMOKE_MODE) {
    await runSmokeCheck(win);
}

/** Locates the prebuilt standalone bundle that this shell serves. */
function resolveDistDir(): string {
    const candidates = [
        Deno.env.get("TRILIUM_DIST_DIR"),
        // Running from the repo via `deno task start`.
        import.meta.dirname ? `${import.meta.dirname}/../standalone/dist` : undefined,
        // The bundled binary lives one level deeper (apps/desktop-deno/<bundle>/).
        import.meta.dirname ? `${import.meta.dirname}/../../standalone/dist` : undefined,
        // Fallbacks relative to the working directory.
        `${Deno.cwd()}/../standalone/dist`,
        `${Deno.cwd()}/../../standalone/dist`,
        `${Deno.cwd()}/apps/standalone/dist`
    ];

    for (const dir of candidates) {
        if (!dir) {
            continue;
        }
        try {
            Deno.statSync(`${dir}/index.html`);
            return dir;
        } catch {
            // Try the next candidate.
        }
    }

    console.error(
        "Could not find the standalone build. Run `pnpm --filter standalone build` first,\n" +
        "or point TRILIUM_DIST_DIR at a directory containing its dist output."
    );
    Deno.exit(1);
}

/** Where the user's database lives on the host filesystem. */
function resolveDataDir(): string {
    const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
    const dir = Deno.env.get("TRILIUM_DATA_DIR") ??
        `${Deno.env.get("XDG_DATA_HOME") ?? `${home}/.local/share`}/trilium-deno-desktop`;
    Deno.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Executes SQL from the standalone worker against the native database.
 * Values are JSON with blobs as `{__trilium_blob__: <base64>}`; parameters
 * arrive positionally (array) or named (`{named: {...}}`).
 */
async function handleSqlRoute(req: Request): Promise<Response> {
    if (req.method === "GET") {
        return Response.json({
            desktopSqlBridge: true,
            engine: `node:sqlite (Deno ${Deno.version.deno})`,
            path: dbPath
        });
    }
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    let payload: { op: string; sql?: string; params?: unknown; raw?: boolean; pluck?: boolean };
    try {
        payload = await req.json();
    } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    sqlOps++;
    try {
        return Response.json(executeSqlOp(payload));
    } catch (e) {
        return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 500 }
        );
    }
}

function executeSqlOp(
    payload: { op: string; sql?: string; params?: unknown; raw?: boolean; pluck?: boolean }
): Record<string, unknown> {
    switch (payload.op) {
        case "exec": {
            db.exec(String(payload.sql));
            return {};
        }
        case "run": {
            const result = invokeStatement(String(payload.sql), payload.params, "run") as {
                changes: number | bigint;
                lastInsertRowid: number | bigint;
            };
            return {
                changes: Number(result.changes),
                lastInsertRowid: Number(result.lastInsertRowid)
            };
        }
        case "get": {
            const sql = String(payload.sql);
            const row = invokeStatement(sql, payload.params, "get");
            return { row: projectRow(statementCache.get(sql), row, payload.raw, payload.pluck) };
        }
        case "all": {
            const sql = String(payload.sql);
            const rows = invokeStatement(sql, payload.params, "all") as unknown[];
            const stmt = statementCache.get(sql);
            return { rows: rows.map((row) => projectRow(stmt, row, payload.raw, payload.pluck)) };
        }
        case "status": {
            return { inTransaction: db.isTransaction === true };
        }
        case "serialize": {
            // node:sqlite has no serialize API; VACUUM INTO a temp file and
            // return its bytes.
            const tmpPath = `${dbPath}.serialize-${crypto.randomUUID()}.tmp`;
            db.exec(`VACUUM INTO '${tmpPath}'`);
            try {
                return { blob: encodeBase64(Deno.readFileSync(tmpPath)) };
            } finally {
                Deno.removeSync(tmpPath);
            }
        }
        default:
            throw new Error(`Unknown SQL bridge op: ${payload.op}`);
    }
}

/** Prepares (with caching) and invokes a statement with decoded parameters. */
function invokeStatement(sql: string, params: unknown, method: "run" | "get" | "all"): unknown {
    let stmt = statementCache.get(sql);
    if (!stmt) {
        stmt = db.prepare(sql);
        statementCache.set(sql, stmt);
    }

    if (params && typeof params === "object" && !Array.isArray(params) && "named" in params) {
        const named: Record<string, unknown> = {};
        for (const [key, value] of Object.entries((params as { named: Record<string, unknown> }).named ?? {})) {
            named[key] = decodeSqlValue(value);
        }
        return stmt[method](named as never);
    }

    const positional = (Array.isArray(params) ? params : []).map(decodeSqlValue);
    return stmt[method](...positional as never[]);
}

function decodeSqlValue(value: unknown): unknown {
    if (value && typeof value === "object" && "__trilium_blob__" in value) {
        return decodeBase64((value as { __trilium_blob__: string }).__trilium_blob__);
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (value === undefined) {
        return null;
    }
    return value;
}

function encodeSqlValue(value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { __trilium_blob__: encodeBase64(value) };
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    return value;
}

/** Applies raw/pluck projection using the statement's real column order. */
function projectRow(
    stmt: StatementSync | undefined,
    row: unknown,
    raw?: boolean,
    pluck?: boolean
): unknown {
    if (row === undefined || row === null) {
        return null;
    }
    const record = row as Record<string, unknown>;
    if ((raw || pluck) && stmt) {
        const columns = stmt.columns().map((c) => String(c.name));
        if (pluck) {
            return encodeSqlValue(record[columns[0]]);
        }
        return columns.map((name) => encodeSqlValue(record[name]));
    }
    const encoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        encoded[key] = encodeSqlValue(value);
    }
    return encoded;
}

async function handleDatabaseRoute(req: Request): Promise<Response> {
    if (req.method === "GET") {
        try {
            const bytes = await Deno.readFile(snapshotPath);
            return new Response(bytes, {
                headers: { "content-type": "application/x-sqlite3" }
            });
        } catch {
            // Bridge present, but nothing saved yet.
            return new Response(null, { status: 204 });
        }
    }

    if (req.method === "PUT") {
        dbSaveAttempts++;
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.byteLength === 0) {
            return new Response("Empty database refused", { status: 400 });
        }
        // Write-then-rename so a crash mid-save cannot corrupt the database.
        const tmpPath = `${snapshotPath}.tmp`;
        await Deno.writeFile(tmpPath, bytes);
        await Deno.rename(tmpPath, snapshotPath);
        return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
}

function wantsHtml(req: Request): boolean {
    const { pathname } = new URL(req.url);
    return !/\.[a-z0-9]+$/i.test(pathname) &&
        (req.headers.get("accept") ?? "").includes("text/html");
}

/** Same headers the standalone Vite server sends (COOP only, no COEP). */
function withSecurityHeaders(res: Response): Response {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return res;
}

/**
 * Native capabilities exposed to the webview. The Trilium client does not
 * know about these yet — they are callable as `bindings.<name>()` from the
 * page (try it from DevTools) and demonstrate what an `electronApi`-style
 * bridge looks like without IPC or a preload script.
 */
function registerBindings(win: Deno.BrowserWindow) {
    win.bind("desktopInfo", async () => ({
        runtime: `Deno ${Deno.version.deno}`,
        v8: Deno.version.v8,
        typescript: Deno.version.typescript,
        os: Deno.build.os,
        arch: Deno.build.arch,
        appVersion: Deno.desktopVersion
    }));

    win.bind("showNotification", async (title, body) => {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            new Notification(String(title), { body: String(body ?? "") });
        }
        return permission;
    });

    win.bind("setBadge", async (text) => {
        Deno.dock.setBadge(text == null ? null : String(text));
    });

    win.bind("openDevtools", async () => {
        win.openDevtools();
    });

    win.bind("openExternal", async (url) => {
        const parsed = new URL(String(url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`Refusing to open non-web URL: ${parsed.protocol}`);
        }
        const opener = Deno.build.os === "darwin"
            ? "open"
            : Deno.build.os === "windows"
            ? "explorer"
            : "xdg-open";
        await new Deno.Command(opener, { args: [parsed.href] }).output();
    });
}

/** System tray icon with show/quit menu, mirroring the Electron tray. */
function setupTray(win: Deno.BrowserWindow): Deno.Tray | null {
    let iconBytes: Uint8Array;
    try {
        iconBytes = Deno.readFileSync(`${distDir}/assets/icon.png`);
    } catch {
        return null;
    }

    const tray = new Deno.Tray();
    tray.setIcon(iconBytes);
    tray.setTooltip("Trilium Notes");
    tray.setMenu([
        { item: { label: "Show Trilium", id: "show", enabled: true } },
        "separator",
        { item: { label: "Quit", id: "quit", enabled: true } }
    ]);
    tray.addEventListener("menuclick", (e) => {
        if (e.detail.id === "show") {
            win.show();
            win.focus();
        } else if (e.detail.id === "quit") {
            tray.destroy();
            Deno.exit(0);
        }
    });
    return tray;
}

/**
 * Headless-ish verification for CI / agent runs (TRILIUM_SMOKE=1): polls the
 * page through `executeJs` until the service worker controls the page and
 * the client has rendered, then exits 0. Exits 1 on timeout with the last
 * observed state, so failures are diagnosable without seeing the window.
 */
async function runSmokeCheck(win: Deno.BrowserWindow) {
    const deadlineAt = Date.now() + 120_000;
    let lastState: unknown = null;

    while (Date.now() < deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
            const raw = unwrapExecuteJs(await win.executeJs(`(() => {
                const selectors = ["#launcher-pane", ".tree-wrapper", "#root-widget", ".setup-app"];
                return JSON.stringify({
                    url: location.href,
                    readyState: document.readyState,
                    title: document.title,
                    swControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
                    opfs: !!(navigator.storage && navigator.storage.getDirectory),
                    matched: selectors.filter((s) => document.querySelector(s)),
                    bodyChildren: document.body ? document.body.children.length : 0,
                    bodyPreview: document.body ? document.body.innerText.trim().slice(0, 160) : ""
                });
            })()`));
            const state = typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, any>;
            lastState = state;
            console.log("[smoke]", JSON.stringify(state));
            // The first run lands on the setup wizard, an established run on
            // the full app — either proves the shell + worker stack is up.
            if (state.swControlled && state.readyState === "complete" && state.bodyChildren >= 1) {
                console.log("SMOKE_UI_OK");
                await reportPersistence();
                await driveSetup(win);
                Deno.exit(0);
            }
        } catch (e) {
            lastState = String(e);
            console.log("[smoke] executeJs failed:", lastState);
        }
    }

    console.error("SMOKE_TIMEOUT", JSON.stringify(lastState));
    Deno.exit(1);
}

/**
 * Waits for the worker to reach the shell's persistence layer: SQL bridge
 * operations against the native database (the normal path), or legacy
 * snapshot save attempts.
 */
async function reportPersistence() {
    const deadlineAt = Date.now() + 40_000;
    while (Date.now() < deadlineAt) {
        if (sqlOps > 0) {
            const stat = await Deno.stat(dbPath);
            console.log(`SMOKE_SQL_BRIDGE_OK ${sqlOps} ops against ${dbPath} (${stat.size} bytes)`);
            return;
        }
        if (dbSaveAttempts > 0) {
            console.log(`SMOKE_SNAPSHOT_BRIDGE_OK (${dbSaveAttempts} save attempt(s))`);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    console.log("SMOKE_PERSISTENCE_MISSING (no SQL bridge traffic or snapshot save observed)");
}

/**
 * Completes the real setup flow (schema creation + demo document import)
 * against the throwaway smoke database — the heaviest workload the SQL
 * bridge sees, including blob writes and large transactions.
 */
async function driveSetup(win: Deno.BrowserWindow) {
    await win.executeJs(
        `window.__smokeSetup = "pending";
        fetch("/api/setup/new-document", { method: "POST" }).then(
            (r) => { window.__smokeSetup = String(r.status); },
            (e) => { window.__smokeSetup = "error: " + e; }
        );
        "started"`
    );

    const deadlineAt = Date.now() + 120_000;
    while (Date.now() < deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const status = unwrapExecuteJs(await win.executeJs("window.__smokeSetup"));
        if (status !== "pending" && status != null) {
            const stat = await Deno.stat(dbPath);
            console.log(`SMOKE_SETUP_DONE status=${status}, db=${stat.size} bytes, sqlOps=${sqlOps}`);
            return;
        }
    }
    console.log(`SMOKE_SETUP_TIMEOUT (sqlOps=${sqlOps})`);
}

/** executeJs may wrap results as {ok, value} depending on the backend. */
function unwrapExecuteJs(raw: unknown): unknown {
    if (raw && typeof raw === "object" && "value" in raw) {
        return (raw as { value: unknown }).value;
    }
    return raw;
}
