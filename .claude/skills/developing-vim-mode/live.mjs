#!/usr/bin/env node
/**
 * Types Vim keys into a text note of a running Trilium instance and prints what Vim mode shows
 * after each step. Every write to the server is held, so the note, the options and the open tabs
 * of the instance stay as they were.
 *
 *   node .claude/skills/developing-vim-mode/live.mjs [options] [keys ...]
 *
 *   --url <base>         the instance (default: TRILIUM_URL, or http://127.0.0.1:37999/)
 *   --note <noteId>      the text note to open in a tab of its own (default: TRILIUM_NOTE_ID)
 *   --create-note        create a scratch text note instead; for an in-memory fixture only
 *   --content <file>     HTML to load into the editor before the keys; it is never saved
 *   --script <file.mjs>  run the scenario that the module exports by default
 *   --option name=value  an option for this page only, such as vimModeHintsEnabled=false
 *   --delay <ms>         the pause after each key (default: 25)
 *   --headed             show the browser
 *   --json               print each state as a line of JSON, with the HTML of the note
 *
 * Each `keys` argument is one step in Vim notation: dd, 3j, "<Esc>", ":s/a/b/<CR>", "<C-r>".
 * A literal `<` is `<lt>`. When the instance asks for a password, it comes from TRILIUM_PASSWORD.
 *
 * A scenario gets the session: `export default async ({ keys, state, setContent, check, page,
 * evaluate, reload }) => { … }`. The exit code is 1 when a check fails or a step throws.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { openSession, parseArgs, UsageError } from "./session.mjs";

let session = null;
let hasFailed = false;
try {
    const args = parseArgs(process.argv.slice(2));
    const { script, steps } = readSteps(args.rest);
    session = await openSession(args);
    if (args.content) {
        await session.setContent(readFileSync(args.content, "utf8"));
    }
    if (script) {
        const scenario = await import(pathToFileURL(resolve(script)).href);
        await scenario.default(session);
    }
    for (const step of steps) {
        await session.keys(step);
        printState(step, await session.state(), args.isJson);
    }
} catch (error) {
    hasFailed = true;
    console.error(error instanceof UsageError ? error.message : error);
} finally {
    hasFailed = await session?.close() || hasFailed;
}
process.exit(hasFailed ? 1 : 0);

/** The scenario and the steps among the arguments that are not options of the session. */
function readSteps(rest) {
    const steps = [ ...rest ];
    const at = steps.indexOf("--script");
    if (at === -1) {
        return { script: null, steps };
    }
    const [ , script ] = steps.splice(at, 2);
    if (!script) {
        throw new UsageError("--script needs a value.");
    }
    return { script, steps };
}

function printState(step, state, isJson) {
    if (isJson) {
        console.log(JSON.stringify({ keys: step, ...state }));
        return;
    }
    const { lines } = state;
    const text = lines.join("|");
    console.log(`> ${step}`);
    console.log(`  mode: ${state.mode}${state.isOneCommand ? " (one command)" : ""}`
        + `   cursor: ${state.cursor}   lines: ${lines.length}`
        + (state.pending ? `   pending: ${state.pending}` : "")
        + (state.recording ? `   recording: @${state.recording}` : "")
        + (state.commandLine === null ? "" : `   command line: ${state.commandLine}`)
        + (state.isSelectionCollapsed ? "" : "   selection: expanded"));
    if (state.message) {
        console.log(`  message: ${state.message}`);
    }
    console.log(`  ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`);
}
