import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Starts the server in dev mode on a fresh data directory, creates a new document with the demo
 * content through the setup API, and resolves with its base URL and a `stop()` function. The
 * data directory reuses `apps/server/spec/db/config.ini`, which turns the login off, and backend
 * scripting is on so that `seedDocument()` can add what the demo lacks.
 */
export async function startDemoServer({ repoRoot, port, logPath }) {
    const serverDir = path.join(repoRoot, "apps", "server");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-store-"));
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

    return { baseUrl, stop };
}

/**
 * Runs `seed` as a backend script on the server, from a page of the app that supplies the CSRF
 * headers. `seed` runs with the backend script `api` in scope. The server runs a script sent this
 * way in the bundle of `currentNoteId`, which must be a JavaScript note.
 */
export async function seedDocument(browser, baseUrl, seed) {
    const scriptNoteId = await findNoteId(baseUrl,
        "note.type = 'code' AND note.mime *=* 'javascript'");
    const page = await browser.newPage();
    try {
        await page.goto(baseUrl);
        await page.waitForFunction(() => window.glob?.getHeaders, null, { timeout: 120_000 });
        const result = await page.evaluate(async ({ script, noteId }) => {
            const response = await fetch("api/script/exec", {
                method: "POST",
                headers: { ...await window.glob.getHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    script, params: [], startNoteId: noteId, currentNoteId: noteId,
                    originEntityName: "notes", originEntityId: null, transactional: true
                })
            });
            return response.json();
        }, { script: seed.toString(), noteId: scriptNoteId });
        if (!result.success) {
            throw new Error(`Seeding the demo document failed: ${result.error}`);
        }
    } finally {
        await page.close();
    }
}

/** Finds the ID of the first note matching a search query, such as `note.title = 'Mind Map'`. */
export async function findNoteId(baseUrl, query) {
    const params = new URLSearchParams({ searchString: query });
    const response = await fetch(`${baseUrl}/api/search?${params}`);
    const [ noteId ] = await response.json();
    if (!noteId) {
        throw new Error(`No note in the demo document matches ${query}.`);
    }
    return noteId;
}

async function waitFor(check, hasExited, timeout) {
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
