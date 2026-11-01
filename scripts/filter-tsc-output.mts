/**
 * Runs `tsc --build` and filters out noisy cascade errors (TS6305).
 * Numbers each remaining error and prints a summary at the end.
 *
 * The compiler is the native (Go) one, installed as `@typescript/native` -- it
 * does the same build several times faster. The `typescript` dependency stays
 * on 6.x because TypeScript 7 ships no JS compiler API, and TypeDoc,
 * typescript-eslint and the browser-side script editor all load it.
 * See "Two TypeScript versions, on purpose" in CLAUDE.md.
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const TSC = fileURLToPath(new URL("../node_modules/@typescript/native/bin/tsc", import.meta.url));
const SUPPRESSED_CODES = [ "TS6305" ];
const ERROR_LINE_PATTERN = /^.+\(\d+,\d+\): error TS\d+:/;

const result = spawnSync(process.execPath, [ TSC, "--build" ], {
    encoding: "utf-8",
    stdio: [ "inherit", "pipe", "pipe" ]
});

if (result.error) {
    console.error(`Failed to run ${TSC}: ${result.error.message}`);
    process.exit(1);
}

const output = (result.stdout ?? "") + (result.stderr ?? "");

const lines = output.split(/\r?\n/);
const filtered = lines.filter(
    (line) => !SUPPRESSED_CODES.some((code) => line.includes(code))
);

let errorIndex = 0;
const numbered: string[] = [];
const seen = new Set<string>();
let skipContinuation = false;

for (const line of filtered) {
    if (ERROR_LINE_PATTERN.test(line)) {
        if (seen.has(line)) {
            skipContinuation = true;
            continue;
        }
        seen.add(line);
        skipContinuation = false;
        errorIndex++;
        numbered.push(`[${errorIndex}] ${line}`);
    } else if (line.trim()) {
        // Continuation line (indented context for multi-line errors)
        if (!skipContinuation) {
            numbered.push(line);
        }
    }
}

if (errorIndex > 0) {
    console.log(numbered.join("\n"));
    console.log(`\n${errorIndex} error(s) found.`);
    process.exit(1);
} else if (result.status !== 0) {
    // The compiler failed without emitting anything we recognise as a diagnostic
    // (crash, bad option, missing binary). Never report that as a clean build.
    console.error(output.trim() || `tsc exited with code ${result.status}.`);
    process.exit(result.status ?? 1);
} else {
    console.log("No errors found.");
}
