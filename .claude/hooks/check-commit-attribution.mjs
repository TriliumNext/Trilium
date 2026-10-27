// A `PreToolUse` hook (see `.claude/settings.json`) for the `Assisted-by` trailer that CLAUDE.md
// requires on a `git commit` or `git commit-tree`, naming the model. A commit without it gets the
// trailer added through `--trailer`, with the model read from the transcript. A commit crediting
// Claude with `Co-Authored-By`, one whose message file the hook cannot read, or one the hook cannot
// fix, is blocked.
//
// Dry run, which prints what the hook does with a command and runs nothing:
//     node .claude/hooks/check-commit-attribution.mjs --dry-run [--model <id>] [--cwd <dir>] -- <command>
// `--model` defaults to `claude-opus-5-5`; an id of another shape, such as `none`, shows the
// commits the hook blocks when it cannot read the model.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** `git` at the start of a command, with its global options, running `commit` or `commit-tree`. */
const COMMIT = /(?:^|[;&|(\n]\s*)git(?:\s+-[cC]\s+\S+|\s+--\S+)*\s+commit(?:-tree)?(?=\s|$)/g;
const QUOTED = /"[^"]*"|'[^']*'/g;
const MESSAGE_FLAG = /\s(?:-[a-zA-Z]*[mF]|--message|--file)(?=[\s"'=]|$)/;
const FILE_FLAG = /\s(?:-F\s*|--file[=\s]\s*)("[^"]+"|'[^']+'|[^\s;&|]+)/g;
const TRAILER = /Assisted-by: Claude Code \([^()<>\n"']+\)/;
const CO_AUTHOR = /Co-Authored-By: Claude/i;
/** Every `Assisted-by` line, to tell whether the last one is a Claude line that `TRAILER` rejects. */
const ANY_TRAILER = /Assisted-by: [^\n"']*/g;
const CLAUDE_TRAILER = /^Assisted-by: Claude\b/;
/** `NAME=value` at the start of a command, as `S="…" && git commit -F "$S/msg.txt"` sets. */
const ASSIGNMENT = /(?:^|[;&|(\n]\s*)(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]*)/g;
const VARIABLE = /\$\{(\w+)\}|\$(\w+)/g;
const GIT_DIR = /\s-C\s+("[^"]*"|'[^']*'|\S+)/g;
const SEPARATOR = /&&|\|\|?|;|\n/;
const HEREDOC = /<<-?\s*(["']?)(\w+)\1/;
/** A `cat` line, which writes a heredoc to a file with `cat > file <<EOF` or `cat <<EOF > file`. */
const CAT_LINE = /(?:^|[;&|(\n]\s*)cat\b([^\n]*)\n/g;
const REDIRECT = /(?<!>)>(?!>)\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/;
/** A model id such as `claude-opus-5-5`, `claude-fable-5-1[1m]` or `claude-haiku-4-5-20251001`. */
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/;
/** How much of the end of the transcript is searched for the model of the last reply. */
const TRANSCRIPT_TAIL = 1024 * 1024;

const EXPECTED = "Commit messages written with Claude Code end with a trailer naming the model, "
    + "e.g. `Assisted-by: Claude Code (Claude Opus 5.5)`, and never credit it with "
    + "`Co-Authored-By` (CLAUDE.md, \"Commit messages\"). Add the trailer and commit again.";

/**
 * What the hook does with `command`: `{ action: "pass" }`, `{ action: "block", reason }`, or
 * `{ action: "rewrite", command, trailer }` with `--trailer` added to each commit that needs it.
 * `modelName` is the display name for the trailer, such as `Claude Opus 5.5`, or `null` when the
 * model is unknown, which blocks a commit that needs the trailer.
 */
export function checkCommand(command, cwd, modelName = null) {
    // Quoted text is masked, so `git commit` or a separator inside an argument such as a search
    // pattern is not taken for one, while a quoted `git -C` path still reads as a word.
    const unquoted = command.replace(QUOTED, (quoted) => "_".repeat(quoted.length));
    const trailer = modelName ? `Assisted-by: Claude Code (${modelName})` : null;
    const insertions = [];
    for (const match of unquoted.matchAll(COMMIT)) {
        const start = match.index;
        const commandEnd = start + match[0].length;
        const variables = readAssignments(command.slice(0, start));
        const written = readHeredocFiles(command.slice(0, start), cwd, variables);
        const gitCwd = readGitDirectory(command.slice(start, commandEnd), cwd, variables);
        const end = findCommitEnd(command, unquoted, commandEnd);
        const verdict = checkCommit(command.slice(start, end), gitCwd, variables, written);
        if (verdict.action === "pass") {
            continue;
        }
        if (verdict.action === "block" || !trailer || match[0].endsWith("-tree")) {
            return { action: "block", reason: verdict.reason };
        }
        const gitEnd = start + match[0].indexOf("git") + "git".length;
        insertions.push(
            { at: gitEnd, text: ` -c trailer.ifexists=${verdict.ifExists}` },
            { at: commandEnd, text: ` --trailer "${trailer}"` }
        );
    }
    if (!insertions.length) {
        return { action: "pass" };
    }
    let rewritten = command;
    for (const { at, text } of insertions.toReversed()) {
        rewritten = rewritten.slice(0, at) + text + rewritten.slice(at);
    }
    return { action: "rewrite", command: rewritten, trailer };
}

/**
 * The display name of a model id, `claude-opus-5-5` → `Claude Opus 5.5`, or `null` for an id
 * of another shape.
 */
export function toModelName(modelId) {
    const match = MODEL_ID.exec(modelId ?? "");
    if (!match) {
        return null;
    }
    const [ , family, major, minor ] = match;
    const version = minor === undefined ? major : `${major}.${minor}`;
    return `Claude ${family[0].toUpperCase()}${family.slice(1)} ${version}`;
}

/** The model of the last assistant reply in the transcript at `path`, or `null`. */
export function readTranscriptModel(path) {
    let text;
    try {
        const size = statSync(path).size;
        const length = Math.min(size, TRANSCRIPT_TAIL);
        const buffer = Buffer.alloc(length);
        const fd = openSync(path, "r");
        try {
            readSync(fd, buffer, 0, length, size - length);
        } finally {
            closeSync(fd);
        }
        text = buffer.toString("utf8");
    } catch {
        return null;
    }
    for (const line of text.split("\n").toReversed()) {
        if (!line.includes("\"assistant\"")) {
            continue;
        }
        try {
            const entry = JSON.parse(line);
            if (entry.type === "assistant" && entry.message?.model) {
                return entry.message.model;
            }
        } catch {
            // The first line of the tail is usually cut off.
        }
    }
    return null;
}

/** The directory git runs in after the `-C` options of `gitCommand`, each relative to the last. */
function readGitDirectory(gitCommand, cwd, variables) {
    let directory = cwd;
    for (const [ , word ] of gitCommand.matchAll(GIT_DIR)) {
        directory = resolve(directory, toNativePath(unquote(word, variables)));
    }
    return directory;
}

/**
 * Where the commit starting before `from` ends: at the next separator, or after the end line of a
 * heredoc it reads its message from.
 */
function findCommitEnd(command, unquoted, from) {
    const separator = unquoted.slice(from).search(SEPARATOR);
    if (separator === -1) {
        return command.length;
    }
    const heredoc = HEREDOC.exec(command.slice(from, from + separator));
    if (!heredoc) {
        return from + separator;
    }
    const delimiter = new RegExp(`\\n\\s*${heredoc[2]}\\s*(?:\\n|$)`);
    const body = delimiter.exec(command.slice(from + separator));
    return body ? from + separator + body.index + body[0].length : command.length;
}

/**
 * `{ action: "pass" }` for a commit that carries the trailer or has no message of its own,
 * `{ action: "block", reason }` for one crediting Claude as co-author or whose message file cannot
 * be read, and otherwise `{ action: "fix", reason, ifExists }`, where `ifExists` is the
 * `trailer.ifexists` mode that adds the trailer without repeating it. `written` maps the absolute
 * paths of the files the command writes from a heredoc before the commit to their contents.
 */
function checkCommit(args, cwd, variables, written) {
    if (!MESSAGE_FLAG.test(args)) {
        // No message of its own, as with `--amend --no-edit`.
        return { action: "pass" };
    }

    const messages = [ args ];
    let unreadablePath = null;
    for (const [ , quoted ] of args.matchAll(FILE_FLAG)) {
        const path = unquote(quoted, variables);
        if (path === "-") {
            continue;
        }
        const text = written.get(resolve(cwd, toNativePath(path))) ?? readMessage(path, cwd);
        if (text === null) {
            unreadablePath ??= path;
        } else {
            messages.push(text);
        }
    }

    if (messages.some((text) => CO_AUTHOR.test(text))) {
        return { action: "block", reason: EXPECTED };
    }
    if (messages.some((text) => TRAILER.test(text))) {
        return { action: "pass" };
    }
    // An unread file can end with a Claude line that `addIfDifferent` keeps beside the new one.
    if (unreadablePath) {
        return { action: "block", reason: unreadable(unreadablePath) };
    }
    // `replace` swaps the `Assisted-by` line nearest the end, so it applies only when that line
    // is a Claude one, such as `Assisted-by: Claude Opus 5.5`.
    const lastTrailer = messages.flatMap((text) => text.match(ANY_TRAILER) ?? []).at(-1);
    return {
        action: "fix",
        reason: EXPECTED,
        ifExists: lastTrailer && CLAUDE_TRAILER.test(lastTrailer) ? "replace" : "addIfDifferent"
    };
}

/**
 * The files `command` writes from a heredoc through `cat`, as a map from each absolute path to
 * the heredoc's body.
 */
function readHeredocFiles(command, cwd, variables) {
    const written = new Map();
    for (const match of command.matchAll(CAT_LINE)) {
        const heredoc = HEREDOC.exec(match[1]);
        const target = REDIRECT.exec(match[1].replace(HEREDOC, ""));
        if (!heredoc || !target) {
            continue;
        }
        const bodyStart = match.index + match[0].length;
        const delimiter = new RegExp(`^[ \\t]*${heredoc[2]}[ \\t]*$`, "m");
        const end = delimiter.exec(command.slice(bodyStart));
        if (!end) {
            continue;
        }
        const path = resolve(cwd, toNativePath(unquote(target[1], variables)));
        written.set(path, command.slice(bodyStart, bodyStart + end.index));
    }
    return written;
}

/**
 * The variables the shell has set by the end of `command`, from its assignments, each expanded
 * with the ones before it as the shell does.
 */
function readAssignments(command) {
    const variables = {};
    for (const [ , name, value ] of command.matchAll(ASSIGNMENT)) {
        variables[name] = unquote(value, variables);
    }
    return variables;
}

/** A shell word as the shell reads it: single quotes taken literally, any other expanded. */
function unquote(word, variables) {
    if (word.startsWith("'")) {
        return word.slice(1, -1);
    }
    return word.replace(/^"|"$/g, "").replace(VARIABLE, (whole, braced, bare) => {
        const name = braced ?? bare;
        return variables[name] ?? process.env[name] ?? whole;
    });
}

function unreadable(path) {
    return `Could not read the commit message file \`${path}\`. This hook runs before the command, `
        + "so a file the same command writes does not exist yet: write the message in a separate "
        + "command first, then commit with its path.";
}

function readMessage(path, cwd) {
    try {
        return readFileSync(resolve(cwd, toNativePath(path)), "utf8");
    } catch {
        return null;
    }
}

/** Git Bash passes paths such as `/c/Users/...`, which Node on Windows reads as `C:/Users/...`. */
function toNativePath(path) {
    return process.platform === "win32" ? path.replace(/^\/([a-zA-Z])\//, "$1:/") : path;
}

/** Prints what the hook does with the command after `--`, for trying a command without running it. */
function dryRun(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { "dry-run": { type: "boolean" }, model: { type: "string" }, cwd: { type: "string" } },
        allowPositionals: true
    });
    const modelId = values.model ?? "claude-opus-5-5";
    const result = checkCommand(positionals.join(" "), values.cwd ?? process.cwd(), toModelName(modelId));
    if (result.action === "rewrite") {
        process.stdout.write(`rewrite (${result.trailer}):\n${result.command}\n`);
    } else if (result.action === "block") {
        process.stdout.write(`block:\n${result.reason}\n`);
    } else {
        process.stdout.write("pass\n");
    }
}

function runHook() {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const modelName = toModelName(readTranscriptModel(input.transcript_path ?? ""));
    const result = checkCommand(input.tool_input?.command ?? "", input.cwd ?? process.cwd(), modelName);
    if (result.action === "block") {
        process.stderr.write(`${result.reason}\n`);
        process.exit(2);
    }
    if (result.action === "rewrite") {
        // No `permissionDecision`, so the rewritten command goes through the usual permission rules.
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                updatedInput: { ...input.tool_input, command: result.command },
                additionalContext: `The commit attribution hook added \`${result.trailer}\` to the `
                    + "commit through `--trailer`."
            }
        }));
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes("--dry-run")) {
        dryRun(process.argv.slice(2));
    } else {
        runHook();
    }
}
