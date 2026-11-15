#!/usr/bin/env node
/**
 * Captures a startup of the running dev server and compares its requests with the allowlist.
 * Exits with 1 when a request is not allowlisted or an allowlisted one was not made.
 *
 * Usage: TRILIUM_PASSWORD=<password> node check-startup.mjs [--update] [--mobile] [baseUrl]
 *
 * --mobile captures the mobile layout and compares it with mobile-startup-allowlist.txt.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const update = args.includes("--update");
const mobile = args.includes("--mobile");
const baseUrl = args.find((arg) => !arg.startsWith("--"));
const allowlist = path.join(here, `${mobile ? "mobile" : "desktop"}-startup-allowlist.txt`);

const captureFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "startup-check-")), "capture.json");
const run = (script, scriptArgs) => spawnSync(process.execPath, [ path.join(here, script), ...scriptArgs ], { stdio: "inherit" });

const capture = run("capture-requests.mjs", [ ...(mobile ? [ "--mobile" ] : []), captureFile, ...(baseUrl ? [ baseUrl ] : []) ]);
if (capture.status !== 0) {
    process.exit(capture.status ?? 1);
}
const check = run("analyze-requests.mjs", [ "check", captureFile, allowlist, ...(update ? [ "--update" ] : []) ]);
console.log(`Capture kept at ${captureFile}`);
process.exit(check.status ?? 1);
