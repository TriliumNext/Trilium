#!/usr/bin/env node
/**
 * Runs many Vim commands on a note in a running Trilium instance and reports what breaks an
 * invariant: a page error, an invalid model, a mode or a selection left behind, an undo that
 * does not give the note back. Every write to the server is held.
 *
 *   node .claude/skills/developing-vim-mode/simulate.mjs <suite> [options]
 *
 *   lines    print the lines of the note with their kinds, to check a fixture
 *   sweep    run each command of the sweep list on lines of every kind
 *   fuzz     run sessions of random commands
 *   reduce   shorten a failing fuzz session to the commands that matter
 *   timing   time whole-note commands, their undo and their redo, on notes of growing size
 *
 *   --content <file>    the note to test (default: fixture.html beside this script)
 *   --seed <n>          the random seed (default: 1)
 *   --per-kind <n>      sweep: how many lines of each kind (default: 2)
 *   --commands <file>   sweep: the commands to run, one per line, in place of the built-in list
 *   --only <text>       sweep: only the commands that contain this text
 *   --kind <text>       sweep: only the lines whose kind contains this text
 *   --sessions <n>      fuzz: how many sessions, with the seeds seed, seed + 1, … (default: 5)
 *   --steps <n>         fuzz: commands per session (default: 40)
 *   --needle <text>     reduce: a part of the problem to keep, or UNDO, or REDO
 *   --slow <ms>         report a command that costs more than this (default: 800)
 *   --sizes <a,b,c>     timing: the sizes of the generated notes, in lines (default: 100,200,400)
 *   --out <dir>         where the records of failures go (default: a folder in the temp folder)
 *
 * The session options of live.mjs apply too: --url, --note, --create-note, --option, --delay
 * (default here: 3), --headed. The exit code is 1 when a suite found a problem.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openSession, parseArgs, UsageError } from "./session.mjs";

/** The commands of the sweep. Each ends in Normal mode with nothing pending. */
const SWEEP_COMMANDS = [
    "x", "X", "~", "rZ", "D", "dw", "db", "d$", "cc<Esc>", "S<Esc>", "s<Esc>", "cwX<Esc>",
    "ciwX<Esc>", "AZ<Esc>", "IZ<Esc>", "dd", "2dd", "dj", "dk", "yyp", "yyP", "ddp", "ddkP", "xp",
    "Vd", "Vjd", "VU", "Vjc<Esc>", "vjd", "yjP", "gUU", "guu", "g~~", "o<Esc>", "O<Esc>",
    "oZ<Esc>", "OZ<Esc>", "J", "gJ", "3J", ">>", "<<", "Vj>", "dap", "dip", "yapP", "cap<Esc>",
    "vipd", "d}", "d{", "za", "zc", "zo", "<C-a>", "<C-x>", ":d<CR>", ":y<CR>p", ":t.<CR>",
    ":m+1<CR>", ":s/e/E/g<CR>", ":normal Ax<CR>", ":j<CR>", ":sort<CR>"
];

/** The parts that a random command of the fuzz suite is built from. */
const FUZZ = {
    motions: [
        "h", "j", "k", "l", "w", "b", "e", "W", "B", "E", "0", "^", "$", "gg", "G", "(", ")", "{",
        "}", "%", "n", "N", "*", "#", "ge", "+", "-", "_", "<CR>", "<BS>", "<Space>", "<Left>",
        "<Right>", "<Up>", "<Down>", "<Home>", "<End>", "gj", "gk", "H", "M", "L", "]]", "[[",
        "zj", "zk", "]z", "[z", "ma", "'a", "`a", "<C-o>", "<C-i>", "<C-d>", "<C-u>", "<C-f>",
        "<C-b>"
    ],
    operatorMotions: [
        "h", "j", "k", "l", "w", "b", "e", "W", "0", "^", "$", "gg", "G", "(", ")", "}", "{", "%",
        "ge", "+", "-", "_", "fa", "te", ";", "n", "ap", "ip", "]]", "[["
    ],
    objects: [
        "iw", "aw", "iW", "aW", "is", "as", "ip", "ap", "i(", "a(", "i\"", "a\"", "i[", "a[", "i{",
        "a{"
    ],
    operators: [ "d", "c", "y", "gu", "gU", "g~", "g?", ">", "<" ],
    edits: [
        "x", "X", "dd", "D", "J", "gJ", "p", "P", "yy", "Y", "u", "<C-r>", ".", "~", "<C-a>",
        "<C-x>", "rx", "gUU", "guu", "g~~", "ddp", "xp", "yyP", "3dd", "2yy", "5x", ">>", "<<",
        "yyp", "gv", "&"
    ],
    inserts: [ "i", "a", "I", "A", "o", "O", "gi", "gI", "cw", "ciw", "cc", "C", "s", "S", "R" ],
    texts: [
        "hello", " world", "x", "42", "(a)", "café", "**bold**", "# head", "- item", "1. one",
        "<lt>b>", "&amp;"
    ],
    insertKeys: [
        "<CR>", "<BS>", "<C-w>", "<Left>", "<Right>", "<Home>", "<End>", "<Del>", "<C-r>\"",
        "<C-o>x", "<C-o>$", "<Tab>", "<S-Tab>", "<C-t>", "<C-d>", "<S-CR>"
    ],
    ex: [
        ":s/a/A/<CR>", ":%s/the/THE/g<CR>", ":noh<CR>", ":1,3d<CR>", ":normal Ax<CR>",
        ":2,4j<CR>", ":g/a/s/e/E/<CR>", ":v/e/d<CR>", ":undo<CR>", ":redo<CR>", ":3,5y<CR>",
        ":$pu<CR>", ":0pu<CR>", ":2,3m0<CR>", ":1t$<CR>", ":.,+1s/ /_/g<CR>", ":%norm Ay<CR>",
        ":2<CR>", ":$<CR>", ":%d<CR>", ":g/a/d<CR>", ":ck bold<CR>", ":ck italic<CR>",
        ":.,+2ck bold<CR>", ":ck removeFormat<CR>", ":ck heading heading3<CR>",
        ":ck paragraph<CR>", ":ck blockQuote<CR>", ":ck bulletedList<CR>",
        ":ck numberedList<CR>", ":ck todoList<CR>", ":ck indent<CR>", ":ck outdent<CR>",
        ":ck codeBlock<CR>", ":ck horizontalLine<CR>", ":ck underline<CR>", ":ck code<CR>",
        ":sort<CR>", ":%sort<CR>", ":.,+3sort<CR>"
    ],
    searches: [
        "/the<CR>", "/e<CR>", "?a<CR>", "/zzz<CR>", "/(<CR>", "/[<CR>", "/\\d<CR>", "/^<CR>",
        "/$<CR>"
    ],
    visualEnds: [
        "d", "y", "c", "~", "U", "u", "J", "p", "P", "<Esc>", "o<Esc>", "gJ", "r!", "x", "X",
        "D", "Y", "C", "S", "s", "R", ">", "<lt>", ":ck bold<CR>", ":sort<CR>", ":s/a/b/<CR>"
    ],
    folds: [ "za", "zA", "zc", "zC", "zo", "zO" ],
    macros: [
        "qaAx<Esc>jq", "qaxjq", "qbddq", "@a", "@b", "@@", "3@a", "2@b", "qcI# <Esc>jq@c",
        "qa0wcwfoo<Esc>jq3@a"
    ]
};

/** The commands of the timing suite, each of which changes every line of the note. */
const TIMING_COMMANDS = [
    "ggdG", "ggyGP", "ggVGU", "gg>G", "ggVGJ", ":%s/e/E/g<CR>", ":%normal Ax<CR>", ":g/1/d<CR>"
];

const SUITES = [ "lines", "sweep", "fuzz", "reduce", "timing" ];

/** The held writes that the app makes by itself: the saved note, the options, the tab state. */
const EXPECTED_WRITES = /\/api\/(options|notes\/[^/]+\/(data|revision)|recent-notes)/u;

/** How long a command can take before the page counts as stuck. */
const COMMAND_TIMEOUT = 120_000;

/**
 * A command that did not finish within `COMMAND_TIMEOUT`. `page.evaluate()` has no timeout, so a
 * read from the stuck page waits forever: the case is recorded and the run stops.
 */
class StuckPageError extends Error {}

/** How many uncaught errors the page had when the last replay of `reduce` started. */
let errorsBeforeReplay = 0;

let session = null;
let hasFailed = false;
try {
    const args = parseArgs(process.argv.slice(2));
    args.delay ??= 3;
    const run = readSuiteArgs(args);
    mkdirSync(run.out, { recursive: true });
    session = await openSession(args);
    const html = readFileSync(run.content, "utf8");
    const suites = { lines: printLines, sweep, fuzz, reduce, timing };
    hasFailed = await suites[run.suite]({ session, html, run });
} catch (error) {
    hasFailed = true;
    console.error(error instanceof UsageError ? error.message : error);
} finally {
    hasFailed = await session?.close() || hasFailed;
}
process.exit(hasFailed ? 1 : 0);

function readSuiteArgs(args) {
    const here = dirname(fileURLToPath(import.meta.url));
    const run = {
        suite: null, content: args.content ?? join(here, "fixture.html"), seed: 1, perKind: 2,
        commands: null, only: null, kind: null, sessions: 5, steps: 40, needle: null, slow: 800,
        sizes: [ 100, 200, 400 ],
        out: join(tmpdir(), "trilium-vim-simulate")
    };
    const flags = {
        "--seed": [ "seed", Number ], "--per-kind": [ "perKind", Number ],
        "--commands": [ "commands", String ], "--only": [ "only", String ],
        "--kind": [ "kind", String ], "--sessions": [ "sessions", Number ],
        "--steps": [ "steps", Number ], "--needle": [ "needle", String ],
        "--slow": [ "slow", Number ], "--out": [ "out", String ],
        "--sizes": [ "sizes", (value) => value.split(",").map(Number) ]
    };
    const rest = [ ...args.rest ];
    while (rest.length) {
        const arg = rest.shift();
        if (flags[arg]) {
            const [ name, convert ] = flags[arg];
            const value = rest.shift();
            if (value === undefined) {
                throw new UsageError(`${arg} needs a value.`);
            }
            run[name] = convert(value);
        } else if (!run.suite && SUITES.includes(arg)) {
            run.suite = arg;
        } else {
            throw new UsageError(`Unknown argument: ${arg}`);
        }
    }
    if (!run.suite) {
        throw new UsageError(`Name a suite: ${SUITES.join(", ")}.`);
    }
    if (run.suite === "reduce" && !run.needle) {
        throw new UsageError("reduce needs --needle: a part of the problem, or UNDO, or REDO.");
    }
    return run;
}

/** Prints each line of the note with its kind. */
async function printLines({ session, html }) {
    await session.setContent(html);
    const { kinds, lines } = await readLines(session);
    for (const [ line, text ] of lines.entries()) {
        console.log(`${String(line).padStart(4)}  ${kinds[line].padEnd(44)}  ${text.slice(0, 70)}`);
    }
    console.log(`\n${lines.length} lines, ${new Set(kinds).size} kinds`);
    return false;
}

/**
 * Runs every command on lines of every kind. A case fails on a page error, an unexpected write,
 * an invalid model, a mode, pending keys or a selection left behind, a cursor outside the note,
 * an undo that does not restore the note, or a redo that does not bring the change back.
 */
async function sweep({ session, html, run }) {
    await session.setContent(html);
    const { kinds, lines } = await readLines(session);
    const targets = pickLines(kinds, run);
    const commands = (run.commands
        ? readFileSync(run.commands, "utf8").split(/\r?\n/u).filter(Boolean)
        : SWEEP_COMMANDS).filter((command) => !run.only || command.includes(run.only));
    const targetKinds = new Set(targets.map((line) => kinds[line])).size;
    console.log(`${targets.length} lines of ${targetKinds} kinds, ${commands.length} commands, `
        + `${targets.length * commands.length} cases`);

    const record = join(run.out, `sweep-${run.seed}.jsonl`);
    const base = await readSignature(session);
    const times = new Map();
    let failures = 0;
    let cases = 0;
    for (const line of targets) {
        for (const command of commands) {
            cases++;
            const result = await runCase(session, html, base, command, line, run.slow);
            times.set(command, Math.max(times.get(command) ?? 0, result.ms));
            if (result.problems.length) {
                failures++;
                const failure = {
                    suite: "sweep", line, kind: kinds[line], text: lines[line].slice(0, 60),
                    command, problems: result.problems
                };
                appendFileSync(record, `${JSON.stringify(failure)}\n`);
                console.log(`FAIL line ${line} (${kinds[line]}) ${command}: `
                    + result.problems.join("; "));
            }
            if (result.isStuck) {
                console.log(`\nThe page stopped answering, so the run stops here. `
                    + `records: ${record}`);
                return true;
            }
            if (cases % 100 === 0) {
                console.log(`… ${cases} cases, ${failures} failed`);
            }
        }
    }
    const slowest = [ ...times ].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([ command, ms ]) => `${command} ${ms}`).join(" | ");
    console.log(`\n${cases} cases, ${failures} failed`);
    console.log(`slowest commands (ms): ${slowest}`);
    if (failures) {
        console.log(`records: ${record}`);
    }
    return failures > 0;
}

/** The lines that the sweep runs on: the first and the last of each kind, then random ones. */
function pickLines(kinds, run) {
    const random = createRandom(run.seed);
    const byKind = new Map();
    for (const [ line, kind ] of kinds.entries()) {
        if (!run.kind || kind.includes(run.kind)) {
            byKind.set(kind, [ ...byKind.get(kind) ?? [], line ]);
        }
    }
    const targets = new Set();
    for (const lines of byKind.values()) {
        const picks = new Set([ lines[0], lines[lines.length - 1] ].slice(0, run.perKind));
        while (picks.size < Math.min(run.perKind, lines.length)) {
            picks.add(lines[Math.floor(random() * lines.length)]);
        }
        for (const line of picks) {
            targets.add(line);
        }
    }
    return [ ...targets ].sort((a, b) => a - b);
}

/** Runs one command on one line of the baseline, checks it, and puts the baseline back. */
async function runCase(session, html, base, command, line, slow) {
    const problems = [];
    const before = {
        errors: session.errors.length, writes: session.heldWrites.length,
        pageErrors: countPageErrors(session)
    };
    await session.evaluate((at) => {
        window.__vim.clearState();
        window.__vim.clearHistory();
        window.__vim.goto(at);
        window.__vim.startTiming();
    }, line);
    try {
        await typeCommand(session, command);
    } catch (error) {
        if (error instanceof StuckPageError) {
            return { problems: [ error.message ], ms: COMMAND_TIMEOUT, isStuck: true };
        }
        problems.push(String(error.message ?? error));
    }
    const after = await session.evaluate(async () => ({
        ms: await window.__vim.stopTiming(),
        state: window.__vim.state(true),
        problems: window.__vim.validate(),
        hash: window.__vim.hash(),
        lineCount: window.__vim.lines().length,
        cursorLineLength: window.__vim.adapter().getLine(window.__vim.adapter().getCursor().line)
            .length
    }));
    problems.push(...newErrors(session, before), ...after.problems.map((each) => `model: ${each}`));
    problems.push(...describeState(after));
    if (after.ms > slow) {
        problems.push(`slow: ${after.ms} ms`);
    }

    const afterCommand = { errors: session.errors.length, writes: session.heldWrites.length };
    await leaveCommand(session);
    const undone = await revertAll(session, "u", "undo");
    if (await session.evaluate(() => window.__vim.hash()) !== base.hash) {
        problems.push(`undo of ${undone} steps did not restore the note`);
    } else {
        const redone = await revertAll(session, "<C-r>", "redo");
        if (await session.evaluate(() => window.__vim.hash()) !== after.hash) {
            problems.push(`redo of ${redone} steps gave another note`);
        }
        await revertAll(session, "u", "undo");
    }
    problems.push(...newErrors(session, afterCommand).map((each) => `during undo: ${each}`));

    await restoreBaseline(session, html, base, countPageErrors(session) > before.pageErrors);
    return { problems, ms: after.ms };
}

/**
 * Puts the note of the test back for the next case, when undo did not, or when a fold changed
 * which lines show. After an uncaught error the page is loaded again, since such an error can
 * leave the editor unusable.
 */
async function restoreBaseline(session, html, base, hasPageError) {
    const isRestored = async () => {
        const signature = await readSignature(session).catch(() => null);
        return signature?.hash === base.hash && signature.kinds === base.kinds;
    };
    if (!hasPageError) {
        if (await isRestored()) {
            return;
        }
        await session.setContent(html);
        if (await isRestored()) {
            return;
        }
    }
    await session.reload();
    await session.setContent(html);
    if (!await isRestored()) {
        throw new Error("The note of the test cannot be put back, so the run stops here.");
    }
}

/** How many uncaught errors the page has had. */
function countPageErrors(session) {
    return session.errors.filter((each) => each.startsWith("pageerror")).length;
}

/**
 * Runs sessions of random commands. After each command the page must have no new error, a valid
 * model and a cursor inside the note. At the end, undoing everything must give the note back,
 * and redoing everything the note as the session left it.
 */
async function fuzz({ session, html, run }) {
    const record = join(run.out, "fuzz.jsonl");
    let failed = 0;
    let pageErrors = countPageErrors(session);
    for (let seed = run.seed; seed < run.seed + run.sessions; seed++) {
        const result = await runSession(session, html, seed, run.steps, run.slow);
        const hard = result.problems.filter((each) => !each.isSlow);
        const first = hard[0] ? `  <- ${hard[0].problem} at ${hard[0].command}` : "";
        console.log(`seed ${seed}: ${result.commands.length} commands, ${hard.length} problems, `
            + `${result.problems.length - hard.length} slow${first}`);
        if (result.problems.length) {
            appendFileSync(record, `${JSON.stringify({ suite: "fuzz", ...result })}\n`);
        }
        if (hard.length) {
            failed++;
        }
        if (result.problems.some((each) => each.isStuck)) {
            console.log(`\nThe page stopped answering, so the run stops here. records: ${record}`);
            return true;
        }
        // An uncaught error can leave the editor unusable, so the next session gets a new page.
        if (countPageErrors(session) > pageErrors) {
            pageErrors = countPageErrors(session);
            await session.reload();
        }
    }
    console.log(`\n${run.sessions} sessions, ${failed} with problems`);
    if (failed) {
        console.log(`records: ${record}`);
        console.log("shorten one with: simulate.mjs reduce --seed <seed> --needle <part of the "
            + "problem>");
    }
    return failed > 0;
}

async function runSession(session, html, seed, steps, slow) {
    const random = createRandom(seed);
    await session.setContent(html);
    await session.evaluate(() => window.__vim.clearState());
    const base = await session.evaluate(() => window.__vim.hash());
    const lineCount = await session.evaluate(() => window.__vim.lines().length);
    const startLine = Math.floor(random() * lineCount);
    await session.evaluate((at) => window.__vim.goto(at), startLine);
    const commands = [];
    const problems = [];
    for (let step = 0; step < steps; step++) {
        const command = createCommand(random);
        commands.push(command);
        const found = await runStep(session, command, slow);
        problems.push(...found.map((each) => ({ step, command, ...each })));
        if (found.some((each) => !each.isSlow)) {
            return { seed, startLine, commands, problems };
        }
    }
    const end = await session.evaluate(() => window.__vim.hash());
    const beforeRevert = { errors: session.errors.length, writes: session.heldWrites.length };
    const undone = await revertAll(session, "u", "undo");
    if (await session.evaluate(() => window.__vim.hash()) !== base) {
        problems.push({ step: -1, command: "UNDO",
            problem: `undo of ${undone} steps did not restore the note` });
    } else {
        await revertAll(session, "<C-r>", "redo");
        if (await session.evaluate(() => window.__vim.hash()) !== end) {
            problems.push({ step: -1, command: "REDO", problem: "redo gave another note" });
        }
    }
    for (const problem of newErrors(session, beforeRevert)) {
        problems.push({ step: -1, command: "UNDO", problem: `during undo or redo: ${problem}` });
    }
    return { seed, startLine, commands, problems };
}

/** Types one command of a session and returns what it broke. */
async function runStep(session, command, slow) {
    const problems = [];
    const before = { errors: session.errors.length, writes: session.heldWrites.length };
    await session.evaluate(() => window.__vim.startTiming());
    try {
        await typeCommand(session, command);
    } catch (error) {
        if (error instanceof StuckPageError) {
            return [ { problem: error.message, isStuck: true } ];
        }
        problems.push({ problem: String(error.message ?? error) });
    }
    const after = await session.evaluate(async () => ({
        ms: await window.__vim.stopTiming(),
        problems: window.__vim.validate(),
        cursorLine: window.__vim.adapter().getCursor().line,
        lineCount: window.__vim.lines().length
    }));
    problems.push(...newErrors(session, before).map((problem) => ({ problem })));
    problems.push(...after.problems.map((each) => ({ problem: `model: ${each}` })));
    if (after.cursorLine < 0 || after.cursorLine >= after.lineCount) {
        problems.push({ problem: `cursor on line ${after.cursorLine} of ${after.lineCount}` });
    }
    if (after.ms > slow) {
        problems.push({ problem: `slow: ${after.ms} ms`, isSlow: true });
    }
    await leaveCommand(session);
    return problems;
}

/**
 * Replays parts of a failing session of the fuzz suite and keeps the shortest list of commands
 * that still shows the problem.
 */
async function reduce({ session, html, run }) {
    const failure = readFileSync(join(run.out, "fuzz.jsonl"), "utf8").split("\n").filter(Boolean)
        .map((line) => JSON.parse(line)).findLast((each) => each.seed === run.seed);
    if (!failure) {
        throw new UsageError(`No record of seed ${run.seed} in ${join(run.out, "fuzz.jsonl")}.`);
    }
    const isRevert = run.needle === "UNDO" || run.needle === "REDO";
    const failing = failure.problems.find((each) => !each.isSlow && each.step >= 0);
    let commands = isRevert || !failing
        ? failure.commands
        : failure.commands.slice(0, failing.step + 1);
    let replays = 0;
    const shows = async (candidate) => {
        replays++;
        return showsProblem(session, html, failure.startLine, candidate, run.needle);
    };
    if (!await shows(commands)) {
        console.log("The problem does not show when the session is replayed. It can depend on "
            + "what ran before it in the page, or on timing.");
        return true;
    }
    let chunk = Math.ceil(commands.length / 2);
    while (chunk >= 1) {
        let isReduced = false;
        for (let start = 0; start < commands.length; start += chunk) {
            const candidate = [ ...commands.slice(0, start), ...commands.slice(start + chunk) ];
            if (candidate.length && await shows(candidate)) {
                commands = candidate;
                isReduced = true;
                start -= chunk;
            }
        }
        chunk = isReduced ? Math.min(chunk, Math.ceil(commands.length / 2)) : Math.floor(chunk / 2);
    }
    console.log(`\n${commands.length} commands after ${replays} replays, from line `
        + `${failure.startLine}:`);
    console.log(commands.map((command) => `  ${command}`).join("\n"));
    return false;
}

/** Whether `commands`, run from `startLine` of a fresh note, show the problem `needle`. */
async function showsProblem(session, html, startLine, commands, needle) {
    // An uncaught error can leave the editor unusable, so the next replay starts on a new page.
    if (countPageErrors(session) !== errorsBeforeReplay) {
        await session.reload();
    }
    await session.setContent(html);
    await session.evaluate(() => window.__vim.clearState());
    errorsBeforeReplay = countPageErrors(session);
    const base = await session.evaluate(() => window.__vim.hash());
    await session.evaluate((at) => window.__vim.goto(at), startLine);
    for (const command of commands) {
        const found = await runStep(session, command, Infinity);
        if (found.some((each) => each.isStuck)) {
            throw new Error(`The page stopped answering at ${command}, so the replays stop here.`);
        }
        if (found.some((each) => each.problem.includes(needle))) {
            return true;
        }
    }
    if (needle !== "UNDO" && needle !== "REDO") {
        return false;
    }
    const end = await session.evaluate(() => window.__vim.hash());
    await revertAll(session, "u", "undo");
    if (needle === "UNDO") {
        return await session.evaluate(() => window.__vim.hash()) !== base;
    }
    await revertAll(session, "<C-r>", "redo");
    return await session.evaluate(() => window.__vim.hash()) !== end;
}

/**
 * Times each whole-note command, its undo and its redo on generated notes of the sizes asked
 * for. The times are those of the key handlers and of the layout they leave behind. A time that
 * grows faster than the note is what to look at.
 */
async function timing({ session, run }) {
    const commands = TIMING_COMMANDS.filter((command) => !run.only || command.includes(run.only));
    console.log(`${"command".padEnd(20)}${"lines".padStart(7)}${"run".padStart(9)}`
        + `${"undo".padStart(9)}${"redo".padStart(9)}   ms`);
    for (const command of commands) {
        for (const size of run.sizes) {
            await session.setContent(createLargeNote(size));
            const time = async (action) => {
                await session.evaluate(() => window.__vim.startTiming());
                await action();
                return session.evaluate(() => window.__vim.stopTiming());
            };
            const ran = await time(() => typeCommand(session, command));
            await leaveCommand(session);
            const undone = await time(() => revertAll(session, "u", "undo"));
            const redone = await time(() => revertAll(session, "<C-r>", "redo"));
            console.log(`${command.padEnd(20)}${String(size).padStart(7)}`
                + `${String(ran).padStart(9)}${String(undone).padStart(9)}`
                + `${String(redone).padStart(9)}`);
        }
    }
    return false;
}

/** A note of `lineCount` lines: paragraphs with some formatting, headings and list items. */
function createLargeNote(lineCount) {
    const blocks = [];
    for (let line = 1; line <= lineCount; line++) {
        const id = `L${String(line).padStart(5, "0")}`;
        if (line % 25 === 1) {
            blocks.push(`<h2>${id} Section ${Math.ceil(line / 25)}</h2>`);
        } else if (line % 10 === 0) {
            blocks.push(`<ul><li>${id} a list item between the paragraphs</li></ul>`);
        } else if (line % 7 === 0) {
            blocks.push(`<p>${id} A line with <strong>bold words</strong>, <i>italic ones</i> `
                + "and <a href=\"https://example.com/\">a link</a> in it.</p>");
        } else {
            blocks.push(`<p>${id} The quick brown fox jumps over the lazy dog again.</p>`);
        }
    }
    return blocks.join("");
}

/** A random command: a motion, an operator, an edit, typed text, a selection, an Ex command. */
function createCommand(random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    const count = () => (random() < 0.3 ? String(1 + Math.floor(random() * 4)) : "");
    const roll = random();
    if (roll < 0.20) {
        return count() + pick(FUZZ.motions);
    }
    if (roll < 0.26) {
        return count() + pick([ "f", "F", "t", "T" ]) + pick([ "a", "e", "i", " ", "(", "\"" ]);
    }
    if (roll < 0.40) {
        const operator = pick(FUZZ.operators);
        const target = random() < 0.5 ? pick(FUZZ.operatorMotions) : pick(FUZZ.objects);
        const typed = operator === "c" ? `${pick(FUZZ.texts)}<Esc>` : "";
        return count() + operator.replace("<", "<lt>") + target + typed;
    }
    if (roll < 0.54) {
        return count() + pick(FUZZ.edits).replace("<<", "<lt><lt>");
    }
    if (roll < 0.66) {
        const key = random() < 0.4 ? pick(FUZZ.insertKeys) : "";
        const more = random() < 0.4 ? pick(FUZZ.texts) : "";
        return `${count()}${pick(FUZZ.inserts)}${pick(FUZZ.texts)}${key}${more}<Esc>`;
    }
    if (roll < 0.78) {
        const moves = Array.from({ length: 1 + Math.floor(random() * 3) },
            () => pick(FUZZ.operatorMotions)).join("");
        const object = random() < 0.25 ? pick(FUZZ.objects) : "";
        return `${pick([ "v", "V" ])}${moves}${object}${pick(FUZZ.visualEnds)}`;
    }
    if (roll < 0.90) {
        return pick(FUZZ.ex);
    }
    if (roll < 0.94) {
        return pick(FUZZ.searches);
    }
    return roll < 0.97 ? pick(FUZZ.folds) : pick(FUZZ.macros);
}

/** Types `command`, and fails when the page does not answer in time. */
async function typeCommand(session, command) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new StuckPageError(`the page did not answer within `
            + `${COMMAND_TIMEOUT / 1000} s`)), COMMAND_TIMEOUT);
    });
    try {
        await Promise.race([ session.keys(command.replaceAll("<<", "<lt><lt>")), timeout ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Presses Escape until Vim mode is in Normal mode with nothing pending. */
async function leaveCommand(session) {
    for (let tries = 0; tries < 4; tries++) {
        const state = await session.state(true);
        const isIdle = state.mode === "normal" && !state.pending && state.commandLine === null
            && !state.isOneCommand && !state.recording;
        if (isIdle) {
            return;
        }
        await session.keys(state.recording ? "q" : "<Esc>").catch(() => undefined);
    }
}

/** Presses `key` while the editor command `name` is enabled. Returns how many times. */
async function revertAll(session, key, name) {
    let steps = 0;
    const isEnabled = () =>
        session.evaluate((command) => window.__vimEditor().commands.get(command).isEnabled, name);
    while (steps < 400 && await isEnabled()) {
        await session.keys(key).catch(() => undefined);
        steps++;
    }
    return steps;
}

/** The page errors and the unexpected held writes since `before`. */
function newErrors(session, before) {
    const errors = session.errors.slice(before.errors)
        .filter((each) => !each.includes("Failed to load resource"))
        .map((each) => each.split("\n")[0].slice(0, 200));
    const writes = session.heldWrites.slice(before.writes)
        .filter((each) => !EXPECTED_WRITES.test(each)).map((each) => `held write: ${each}`);
    return [ ...errors, ...writes ];
}

/** What the state after a command of the sweep has that it should not. */
function describeState({ state, lineCount, cursorLineLength }) {
    const problems = [];
    const [ line, ch ] = state.cursor.split(":").map(Number);
    if (state.mode !== "normal") {
        problems.push(`mode ${state.mode} at the end`);
    }
    if (state.pending) {
        problems.push(`pending keys ${state.pending}`);
    }
    if (state.commandLine !== null) {
        problems.push("the command line stays open");
    }
    if (state.mode === "normal" && !state.isSelectionCollapsed && !state.isWidgetSelected) {
        problems.push("the selection stays expanded in Normal mode");
    }
    if (line < 0 || line >= lineCount) {
        problems.push(`cursor on line ${line} of ${lineCount}`);
    } else if (state.mode === "normal" && ch > Math.max(cursorLineLength - 1, 0)
        && !state.isWidgetSelected) {
        problems.push(`cursor at column ${ch} of a line of ${cursorLineLength}`);
    }
    return problems;
}

async function readLines(session) {
    return session.evaluate(() => ({ kinds: window.__vim.kinds(), lines: window.__vim.lines() }));
}

/** The hash of the content, and the kinds of the lines that show. */
async function readSignature(session) {
    return session.evaluate(() => ({
        hash: window.__vim.hash(), kinds: window.__vim.kinds().join("\n")
    }));
}

/** A random number generator that gives the same numbers for the same seed. */
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}
