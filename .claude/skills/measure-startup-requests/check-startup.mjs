#!/usr/bin/env node
/**
 * Captures a startup of the running dev server and compares its requests with the allowlist.
 * Exits with 1 when a request is not allowlisted or an allowlisted one was not made.
 *
 * Usage: TRILIUM_PASSWORD=<password> node check-startup.mjs [--update] [baseUrl]
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const update = args.includes("--update");
const baseUrl = args.find((arg) => arg !== "--update");

const captureFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "startup-check-")), "capture.json");
const run = (script, scriptArgs) => spawnSync(process.execPath, [ path.join(here, script), ...scriptArgs ], { stdio: "inherit" });

const capture = run("capture-requests.mjs", baseUrl ? [ captureFile, baseUrl ] : [ captureFile ]);
if (capture.status !== 0) {
    process.exit(capture.status ?? 1);
}
const check = run("analyze-requests.mjs", update ? [ "check", captureFile, "--update" ] : [ "check", captureFile ]);
console.log(`Capture kept at ${captureFile}`);
process.exit(check.status ?? 1);
