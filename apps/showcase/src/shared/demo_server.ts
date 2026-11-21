import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Browser } from "playwright";

import { type BuildOptions, outDir, repoRoot } from "./build.ts";
import { PACKING_MARKDOWN, SEED } from "./seed.ts";

/** A server holding the demo document. */
export interface Server {
    baseUrl: string;
    stop(): void;
}

export interface DemoServer extends Server {
    dataDir: string;
    /** Stops the server and keeps the data directory for another app to open. */
    stopServer(): Promise<void>;
}

/**
 * Uses the running server at `url`, which must hold the demo document and what `SEED` adds and
 * need no login, or else starts one with `startSeededServer()`.
 */
export async function openDemo(browser: Browser,
    { url, port }: Pick<BuildOptions, "url" | "port">): Promise<Server> {
    return url ? { baseUrl: url, stop() {} } : await startSeededServer(browser, port);
}

/**
 * Starts a demo server, adds what `SEED` in `seed.ts` seeds and pins the notes' dates with
 * `pinNoteDates()`.
 */
export async function startSeededServer(browser: Browser, port: number) {
    const server = await startDemoServer({ port, logPath: path.join(outDir, "server.log") });
    try {
        await seedDocument(browser, server.baseUrl, SEED, [ PACKING_MARKDOWN ]);
        await pinNoteDates(browser, server.baseUrl);
    } catch (e) {
        server.stop();
        throw e;
    }
    return server;
}

/**
 * Starts the server in dev mode on a fresh data directory, creates a new document with the demo
 * content through the setup API, and resolves with its base URL and data directory.
 * `stopServer()` stops the server and keeps the data directory for another app to open;
 * `stop()` also removes the directory. The
 * data directory reuses `apps/server/spec/db/config.ini`, which turns the login off, and backend
 * scripting is on so that `seedDocument()` can add what the demo lacks.
 */
export async function startDemoServer({ port, logPath }: { port: number; logPath: string }):
    Promise<DemoServer> {
    const serverDir = path.join(repoRoot, "apps", "server");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-showcase-"));
    const config = path.join(serverDir, "spec", "db", "config.ini");
    fs.copyFileSync(config, path.join(dataDir, "config.ini"));

    const baseUrl = `http://localhost:${port}`;
    const server = spawn(process.execPath, [ "--import", "tsx", "./src/main.ts" ], {
        cwd: serverDir,
        stdio: [ "ignore", "pipe", "pipe" ],
        env: {
            ...process.env,
            NODE_ENV: "development",
            TRILIUM_ENV: "dev",
            TRILIUM_PORT: String(port),
            TRILIUM_DATA_DIR: dataDir,
            TRILIUM_RESOURCE_DIR: "src",
            TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED: "true"
        }
    });
    const log = fs.createWriteStream(logPath);
    server.stdout.pipe(log);
    server.stderr.pipe(log);
    let exited = false;
    server.on("exit", () => { exited = true; });

    const stopServer = () => new Promise<void>((resolve) => {
        if (exited) return resolve();
        server.once("exit", () => resolve());
        server.kill();
    });
    const stop = () => {
        server.kill();
        fs.rmSync(dataDir, { recursive: true, force: true });
    };
    process.on("exit", stop);

    await waitFor(async () => (await fetch(baseUrl)).ok, () => exited, 3 * 60_000);
    const created = await fetch(`${baseUrl}/api/setup/new-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en" })
    });
    if (!created.ok) {
        stop();
        throw new Error(`Creating the demo document failed (${created.status}); see ${logPath}.`);
    }
    const isInitialized = async () => {
        const status = await fetch(`${baseUrl}/api/setup/status`);
        return (await status.json()).isInitialized;
    };
    await waitFor(isInitialized, () => exited, 60_000);

    return { baseUrl, dataDir, stopServer, stop };
}

/**
 * Runs `seed` as a backend script on the server, from a page of the app that supplies the CSRF
 * headers, with `params` as its arguments, sent as JSON, and the backend script `api` in scope.
 * The server runs a script sent this way in the bundle of `currentNoteId`, which must be a
 * JavaScript note.
 */
export async function seedDocument<Params extends unknown[]>(browser: Browser, baseUrl: string,
    seed: (...params: Params) => void, params: Params) {
    const scriptNoteId = await findNoteId(baseUrl,
        "note.type = 'code' AND note.mime *=* 'javascript'");
    const page = await browser.newPage();
    try {
        await page.goto(baseUrl);
        await page.waitForFunction(() => window.glob?.getHeaders, null, { timeout: 120_000 });
        const result = await page.evaluate(async ({ script, params, noteId }) => {
            const response = await fetch("api/script/exec", {
                method: "POST",
                headers: { ...await window.glob.getHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    script, params, startNoteId: noteId, currentNoteId: noteId,
                    originEntityName: "notes", originEntityId: null, transactional: true
                })
            });
            return response.json();
        }, { script: seed.toString(), params, noteId: scriptNoteId });
        if (!result.success) {
            throw new Error(`Seeding the demo document failed: ${result.error}`);
        }
    } finally {
        await page.close();
    }
}

/**
 * The moment every note of the demo document is created and modified at, so that the dates the
 * app shows (such as "Created on" above a text note) do not depend on the day of the build.
 */
const DEMO_DATE = { local: "2026-05-04 18:00:00.000+0200", utc: "2026-05-04 16:00:00.000Z" };

/**
 * Sets the creation and modification dates of every note to `DEMO_DATE`, in the database and in
 * the server's note cache. Call it after the last seed, on a server the build started.
 */
export async function pinNoteDates(browser: Browser, baseUrl: string) {
    await seedDocument(browser, baseUrl, PIN_NOTE_DATES, [ DEMO_DATE ]);
}

/** The part of the backend script API that `PIN_NOTE_DATES` calls. */
declare const api: {
    sql: {
        execute(query: string, params: unknown[]): void;
        getColumn(query: string): string[];
    };
    getNote(noteId: string): Record<string, unknown> | null;
};

function PIN_NOTE_DATES({ local, utc }: typeof DEMO_DATE) {
    api.sql.execute("UPDATE notes SET dateCreated = ?, dateModified = ?, utcDateCreated = ?, "
        + "utcDateModified = ?", [ local, local, utc, utc ]);
    for (const noteId of api.sql.getColumn("SELECT noteId FROM notes")) {
        const note = api.getNote(noteId);
        if (note) {
            Object.assign(note, {
                dateCreated: local, dateModified: local, utcDateCreated: utc, utcDateModified: utc
            });
        }
    }
}

/** Finds the ID of the first note matching a search query, such as `note.title = 'Mind Map'`. */
export async function findNoteId(baseUrl: string, query: string): Promise<string> {
    const params = new URLSearchParams({ searchString: query });
    const response = await fetch(`${baseUrl}/api/search?${params}`);
    const [ noteId ] = await response.json();
    if (!noteId) {
        throw new Error(`No note in the demo document matches ${query}.`);
    }
    return noteId;
}

async function waitFor(check: () => Promise<boolean>, hasExited: () => boolean,
    timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !hasExited()) {
        try {
            if (await check()) return;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("The demo server did not start; see its log.");
}
