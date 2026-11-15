#!/usr/bin/env node
/**
 * Captures a startup of the dev server and compares its requests with the allowlist.
 * Exits with 1 when a request is not allowlisted or an allowlisted one was not made.
 *
 * Usage:
 *   TRILIUM_PASSWORD=<password> node check-startup.mjs [--update] [--mobile] [baseUrl]
 *   node check-startup.mjs --fixture [--update] [--out <dir>]
 *
 * --mobile captures the mobile layout and compares it with mobile-startup-allowlist.txt.
 * --fixture boots a dev server on the e2e fixture database, in memory and without a login, checks
 * the desktop layout and then the mobile one, and stops the server. This is what CI runs.
 * --out keeps the captures in <dir>, for CI to upload.
 *
 * Environment:
 *   STARTUP_CHECK_PORT  port of the --fixture server (default 37988)
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
const update = args.includes("--update");
const fixture = args.includes("--fixture");
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "startup-check-"));
const baseUrlArg = args.find((arg, index) => !arg.startsWith("--") && (outIndex < 0 || index !== outIndex + 1));
fs.mkdirSync(outDir, { recursive: true });

if (fixture) {
    const port = process.env.STARTUP_CHECK_PORT ?? "37988";
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = await startFixtureServer(port, baseUrl);
    let failed = false;
    try {
        for (const mobile of [ false, true ]) {
            failed = !checkLayout(mobile, baseUrl) || failed;
        }
    } finally {
        server.kill();
    }
    if (failed && !update) {
        console.error([
            "",
            "The startup requests differ from the allowlists. Make the new requests lazy, or, when one",
            "is wanted, accept it with `pnpm dev:check-startup --update` and commit the allowlists."
        ].join("\n"));
    }
    process.exit(failed ? 1 : 0);
} else {
    process.exit(checkLayout(args.includes("--mobile"), baseUrlArg) ? 0 : 1);
}

/** Captures one layout's startup into `outDir` and checks it. Returns whether it passed. */
function checkLayout(mobile, baseUrl) {
    const layout = mobile ? "mobile" : "desktop";
    console.log(`\n=== The ${layout} layout`);
    const allowlist = path.join(here, `${layout}-startup-allowlist.txt`);
    const captureFile = path.join(outDir, `${layout}.json`);
    const capture = run("capture-requests.mjs", [ ...(mobile ? [ "--mobile" ] : []), captureFile, ...(baseUrl ? [ baseUrl ] : []) ]);
    if (capture.status !== 0) return false;
    const check = run("analyze-requests.mjs", [ "check", captureFile, allowlist, ...(update ? [ "--update" ] : []) ]);
    console.log(`Capture kept at ${captureFile}`);
    return check.status === 0;
}

function run(script, scriptArgs) {
    return spawnSync(process.execPath, [ path.join(here, script), ...scriptArgs ], { stdio: "inherit" });
}

/**
 * Starts the server in dev mode, so Vite serves the client module by module, on the e2e fixture
 * database held in memory. `spec/db/config.ini` turns the login off. Resolves once it answers.
 */
async function startFixtureServer(port, baseUrl) {
    const serverDir = path.join(repoRoot, "apps", "server");
    const server = spawn(process.execPath, [ "--import", "tsx", "./src/main.ts" ], {
        cwd: serverDir,
        stdio: [ "ignore", "pipe", "pipe" ],
        env: {
            ...process.env,
            NODE_ENV: "development",
            TRILIUM_ENV: "dev",
            TRILIUM_PORT: port,
            TRILIUM_DATA_DIR: "spec/db",
            TRILIUM_DOCUMENT_PATH: path.join(repoRoot, "packages", "trilium-core", "src", "test", "fixtures", "document.db"),
            TRILIUM_INTEGRATION_TEST: "memory",
            TRILIUM_RESOURCE_DIR: "src"
        }
    });
    const log = fs.createWriteStream(path.join(outDir, "server.log"));
    server.stdout.pipe(log);
    server.stderr.pipe(log);
    let exited = false;
    server.on("exit", () => { exited = true; });
    process.on("exit", () => server.kill());

    console.log(`Starting the dev server on the fixture database at ${baseUrl}...`);
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
        if (exited) break;
        try {
            if ((await fetch(baseUrl)).ok) return server;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    server.kill();
    console.error(`The dev server did not answer at ${baseUrl}; see ${path.join(outDir, "server.log")}.`);
    process.exit(1);
}
