#!/usr/bin/env node
// Edits, checks and upgrades Trilium's patch of @excalidraw/excalidraw without `pnpm patch`.
//
//   check               the patch file, its workspace entry, the pinned versions, the hash in
//                       both lockfiles and the installed copy agree
//   open [--force]      scratch git repo for the patched version: the release's files staged as
//                       the base, the patch applied in the working tree
//   changes [file...]   what the patch changes, as word-level snippets; readable for the minified
//                       prod bundle too. [--context n] characters around each change (default 60),
//                       [--version v] reads the scratch repo of another version
//   save [--force]      writes the patch from the scratch repo. For the installed version it also
//                       updates both lockfile hashes and copies the files into node_modules; for a
//                       rebased version it renames the patch and bumps the pinned versions.
//                       --force saves a patch that leaves one of the files unchanged
//   rebase <version> [--force]
//                       carries the patch onto another release by a three-way merge, file by
//                       file, and lists what needs work by hand
//
// Every command takes --dir <scratch dir> (default: <os tmp>/trilium-excalidraw-patch) and
// --root <repository> (default: the repository holding this script). Nothing runs pnpm.
//
// Examples:
//   node .claude/skills/patching-excalidraw/excalidraw_patch.mjs check
//   node .claude/skills/patching-excalidraw/excalidraw_patch.mjs open
//   node .claude/skills/patching-excalidraw/excalidraw_patch.mjs changes dist/prod/index.js
//   node .claude/skills/patching-excalidraw/excalidraw_patch.mjs save
//   node .claude/skills/patching-excalidraw/excalidraw_patch.mjs rebase 0.19.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PACKAGE = "@excalidraw/excalidraw";
const REGISTRY = (process.env.npm_config_registry ?? "https://registry.npmjs.org")
    .replace(/\/$/, "");
/** The options that reproduce the committed patch byte for byte, whatever the user's git config. */
const DIFF_OPTIONS = [
    "diff", "--full-index", "--diff-algorithm=patience", "--src-prefix=a/", "--dst-prefix=b/",
    "--no-color", "--no-ext-diff", "--no-relative"
];
/**
 * The lockfiles that carry the patch hash: the committed one, and pnpm's copy in `node_modules`,
 * whose hash decides when Vite pre-bundles the dependencies again.
 */
const LOCKFILES = [ "pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml" ];
/** A line longer than this marks a minified file, which a three-way merge cannot resolve. */
const MINIFIED_LINE_LENGTH = 5000;

const [ command, ...rest ] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
        positional.push(arg);
    } else if (arg === "--force") {
        flags.force = true;
    } else {
        flags[arg.slice(2)] = rest[++i];
    }
}

const ROOT = resolve(flags.root ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const WORK_DIR = resolve(flags.dir ?? join(tmpdir(), "trilium-excalidraw-patch"));

const commands = { check, open, changes, save, rebase };
if (!commands[command]) {
    const usage = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
    const end = usage.findIndex((line) => !line.startsWith("//"));
    console.log(usage.slice(0, end).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(command ? 1 : 0);
}
await commands[command]();

// --- Commands ---------------------------------------------------------------------------------

function check() {
    const problems = [];
    const { version, patchPath } = readWorkspaceEntry();
    console.log(`pnpm-workspace.yaml patches ${PACKAGE}@${version} with ${rel(patchPath)}`);
    if (!existsSync(patchPath)) fail(`${rel(patchPath)} does not exist.`);
    const patch = readFileSync(patchPath);
    if (patch.includes(13)) {
        problems.push(`${rel(patchPath)} has CR characters; pnpm hashes the LF form`);
    }
    const files = parsePatch(patch.toString("utf8"));
    console.log(`  ${files.length} files: ${files.map((file) => file.path).join(", ")}`);

    for (const { path, pin } of findPins()) {
        const isPinned = pin === version;
        console.log(`  ${isPinned ? "ok  " : "BAD "} ${path} pins ${pin}`);
        if (!isPinned) problems.push(`${path} pins ${pin}, not exactly ${version}`);
    }

    const hash = sha256(patch);
    for (const name of LOCKFILES) {
        if (!existsSync(join(ROOT, name))) {
            console.log(`  -    ${name} does not exist`);
            continue;
        }
        const lockfile = readFileSync(join(ROOT, name), "utf8");
        const lockHash = readLockfileHash(lockfile, version);
        const others = [ ...lockfile.matchAll(/@excalidraw\/excalidraw@\S+?\(patch_hash=(\w+)/g) ]
            .filter((match) => match[1] !== hash);
        const stale = lockHash === hash ? others[0]?.[1] : lockHash ?? "no hash";
        if (!stale) {
            console.log(`  ok   ${name} carries the hash ${count(lockfile, hash)} times`);
        } else {
            problems.push(`${name} carries ${stale}, the patch hashes to ${hash}`
                + " (save, or pnpm install after a version change)");
        }
    }

    const installed = join(ROOT, "node_modules", PACKAGE);
    const installedVersion = readInstalledVersion();
    if (installedVersion !== version) {
        problems.push(`node_modules holds ${PACKAGE} ${installedVersion ?? "nowhere"},`
            + ` not ${version}`);
    } else {
        for (const { path, before, after } of files) {
            const file = join(installed, path);
            const id = existsSync(file) ? blobId(readFileSync(file)) : null;
            const state = id === after
                ? "patched" : id === before ? "UNPATCHED" : "MATCHES NEITHER";
            console.log(`  ${id === after ? "ok  " : "BAD "} node_modules ${path}: ${state}`);
            if (id !== after) {
                problems.push(`node_modules/${PACKAGE}/${path} is not the patched file`);
            }
        }
    }

    if (problems.length) {
        const list = problems.map((problem) => `  - ${problem}`).join("\n");
        console.log(`\n${problems.length} problem(s):\n${list}`);
        process.exit(1);
    }
    console.log("\nAll consistent.");
}

async function open() {
    const { version, patchPath } = readWorkspaceEntry();
    const patch = readFileSync(patchPath);
    const repo = await openRepo(version, patchPath, { isForced: !!flags.force });
    setActiveVersion(version);
    const reproduced = diffPatch(repo, readState(repo));
    console.log(reproduced.equals(patch)
        ? "The scratch repo reproduces the patch byte for byte."
        : "WARNING: the scratch repo does not reproduce the patch byte for byte; `save` writes it"
            + " in the form of `git diff --full-index --diff-algorithm=patience`.");
    console.log(`\nEdit the files under ${repo}, then run \`save\`.`);
}

function changes() {
    const repo = repoDir(flags.version ?? readActiveVersion());
    const state = readState(repo);
    const context = Number(flags.context ?? 60);
    for (const path of positional.length ? positional : state.files) {
        const out = git(repo, [
            "diff", "--no-color", "--no-ext-diff", "-U0", "--word-diff=porcelain",
            "--word-diff-regex=[A-Za-z0-9_$]+|[^[:space:]]", state.baseTree, "--", path
        ]).stdout;
        console.log(`=== ${path}`);
        for (const hunk of parseWordDiff(out)) {
            console.log(`--- ${hunk.header}`);
            console.log(renderWordHunk(hunk.segments, context));
        }
    }
}

async function save() {
    const version = readActiveVersion();
    const repo = repoDir(version);
    const state = readState(repo);
    const unresolved = state.files.filter((path) => hasConflictMarkers(join(repo, path)));
    if (unresolved.length) fail(`Conflict markers remain in ${unresolved.join(", ")}.`);
    git(repo, [ "add", "-A", "--", ...state.files ]);
    checkSyntax(repo, state.files);

    const patch = diffPatch(repo, state);
    if (!patch.length) fail("The scratch repo changes nothing. Remove an empty patch by hand.");
    const patched = new Set(parsePatch(patch.toString("utf8")).map((file) => file.path));
    const unchanged = state.files.filter((path) => !patched.has(path));
    if (unchanged.length && !flags.force) {
        fail(`The patch would leave ${unchanged.join(", ")} unpatched. Carry the changes over`
            + " (`changes --version <old>`), or pass --force if upstream made them unnecessary.");
    }
    const entry = readWorkspaceEntry();
    if (version === entry.version) {
        savePatch(patch, entry, repo, state);
    } else if (state.from === entry.version) {
        saveUpgrade(patch, entry, version);
    } else {
        fail(`The scratch repo holds ${version}, rebased from ${state.from}, but the workspace`
            + ` patches ${entry.version}.`);
    }
}

async function rebase() {
    const target = positional[0];
    if (!target) fail("Name the release: rebase <version>.");
    const { version, patchPath } = readWorkspaceEntry();
    if (target === version) fail(`The patch is already for ${version}; use \`open\`.`);

    const oldRepo = repoDir(version);
    if (!existsSync(oldRepo) || !hasUnsavedEdits(oldRepo)) {
        await openRepo(version, patchPath, {});
    } else {
        console.log(`${oldRepo} holds unsaved edits: the rebase carries the saved patch only.`);
    }
    const repo = repoDir(target);
    if (existsSync(repo) && hasUnsavedEdits(repo) && !flags.force) {
        fail(`${repo} holds edits that \`save\` has not written. Save them, or pass --force.`);
    }
    const patchText = readFileSync(patchPath, "utf8");
    const paths = parsePatch(patchText).map((file) => file.path);
    const newRelease = await fetchRelease(target);
    const oldRelease = await fetchRelease(version);
    const [ oldTree, baseTree ] = initRepo(repo, paths, [ oldRelease, newRelease ]);
    writeState(repo, { version: target, from: version, baseTree, oldTree, files: paths });
    setActiveVersion(target);

    console.log(`Carrying the ${version} patch onto ${target} in ${repo}\n`);
    const handWork = [];
    for (const path of paths) {
        if (!existsSync(join(newRelease, path))) {
            console.log(`  GONE      ${path}: not in ${target}; find where the code moved`);
            handWork.push(path);
            continue;
        }
        const result = git(repo, [ "apply", "--3way", "--whitespace=nowarn", `--include=${path}`,
            patchPath ], { isFailureAllowed: true });
        const isUnmerged = !!git(repo, [ "ls-files", "-u", "--", path ]).stdout.trim();
        if (result.status === 0 && !isUnmerged) {
            console.log(`  merged    ${path}`);
        } else if (isUnmerged && isMinified(join(repo, path))) {
            copyFileSync(join(newRelease, path), join(repo, path));
            git(repo, [ "add", "--", path ]);
            console.log(`  BY HAND   ${path}: minified, reset to ${target};`
                + " carry each change over");
            handWork.push(path);
        } else if (isUnmerged) {
            const markers = count(readFileSync(join(repo, path), "utf8"), "\n<<<<<<< ");
            console.log(`  CONFLICTS ${path}: ${markers} conflict(s); ours is ${target},`
                + ` theirs is the patched ${version}`);
            handWork.push(path);
        } else {
            console.log(`  FAILED    ${path}: ${result.stderr.trim()}`);
            handWork.push(path);
        }
    }

    console.log(`\nA clean merge still needs review: the hunk can land in code that ${target}`
        + " changed around it. What upstream changed in a file:");
    console.log(`  git -C "${repo}" diff ${oldTree} ${baseTree} -- <path>`);
    console.log(`The ${version} changes to carry over by hand:`);
    const script = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll("\\", "/");
    console.log(`  node ${script} changes --version ${version} <path>`);
    if (handWork.length) console.log(`\nBy hand: ${handWork.join(", ")}`);
    console.log("Then run `save`.");
}

// --- Saving -----------------------------------------------------------------------------------

function savePatch(patch, entry, repo, state) {
    const old = readFileSync(entry.patchPath);
    if (old.equals(patch)) {
        console.log(`${rel(entry.patchPath)} is unchanged.`);
    } else {
        writeFileSync(entry.patchPath, patch);
        console.log(`Wrote ${rel(entry.patchPath)}.`);
    }

    const hash = sha256(patch);
    for (const name of LOCKFILES) {
        const lockfilePath = join(ROOT, name);
        if (!existsSync(lockfilePath)) continue;
        const lockfile = readFileSync(lockfilePath, "utf8");
        const lockHash = readLockfileHash(lockfile, entry.version);
        if (!lockHash) {
            console.log(`${name} has no hash for ${entry.version}: run pnpm install.`);
        } else if (lockHash !== hash) {
            writeFileSync(lockfilePath, lockfile.replaceAll(lockHash, hash));
            const places = count(lockfile, lockHash);
            console.log(`Replaced the patch hash in ${name} (${places} places).`);
        }
    }

    if (readInstalledVersion() === entry.version) {
        for (const path of state.files) {
            copyFileSync(join(repo, path), join(ROOT, "node_modules", PACKAGE, path));
        }
        console.log(`Copied ${state.files.length} files into node_modules/${PACKAGE}.`);
        console.log("Restart the dev server to pre-bundle Excalidraw again (under"
            + " `pnpm server:start`, `touch apps/server/src/main.ts` restarts it).");
    } else {
        console.log(`node_modules holds another version of ${PACKAGE}: run pnpm install.`);
    }
}

function saveUpgrade(patch, entry, version) {
    const patchPath = join(ROOT, "patches", `@excalidraw__excalidraw@${version}.patch`);
    writeFileSync(patchPath, patch);
    console.log(`Wrote ${rel(patchPath)}.`);

    const workspacePath = join(ROOT, "pnpm-workspace.yaml");
    const workspace = readFileSync(workspacePath, "utf8");
    writeFileSync(workspacePath, workspace.replace(entry.line,
        entry.line.replaceAll(`@${entry.version}`, `@${version}`)));
    console.log(`Pointed pnpm-workspace.yaml at ${PACKAGE}@${version}.`);

    for (const { path, pin } of findPins()) {
        if (pin !== entry.version) continue;
        const file = join(ROOT, path);
        writeFileSync(file, readFileSync(file, "utf8").replace(
            `"${PACKAGE}": "${entry.version}"`, `"${PACKAGE}": "${version}"`));
        console.log(`Pinned ${version} in ${path}.`);
    }

    unlinkSync(entry.patchPath);
    console.log(`Deleted ${rel(entry.patchPath)}.`);
    console.log("\nNext: pnpm install (it rewrites pnpm-lock.yaml and applies the new patch), then"
        + " `check` and the contract spec.");
}

/** Runs `node --check` on each script, as a module: the bundles are ES modules. */
function checkSyntax(repo, paths) {
    const dir = join(WORK_DIR, "syntax-check");
    mkdirSync(dir, { recursive: true });
    for (const [ index, path ] of paths.filter((p) => p.endsWith(".js")).entries()) {
        const copy = join(dir, `${index}-${basename(path, ".js")}.mjs`);
        copyFileSync(join(repo, path), copy);
        const result = spawnSync(process.execPath, [ "--check", copy ], { encoding: "utf8" });
        if (result.status !== 0) fail(`${path} does not parse:\n${result.stderr}`);
    }
}

// --- Scratch repos ----------------------------------------------------------------------------

/** Builds the scratch repo of `version` with `patchPath` applied, unless it holds unsaved edits. */
async function openRepo(version, patchPath, { isForced = false }) {
    const repo = repoDir(version);
    if (existsSync(repo) && hasUnsavedEdits(repo) && !isForced) {
        fail(`${repo} holds edits that \`save\` has not written. Save them, or pass --force.`);
    }
    const paths = parsePatch(readFileSync(patchPath, "utf8")).map((file) => file.path);
    const [ baseTree ] = initRepo(repo, paths, [ await fetchRelease(version) ]);
    git(repo, [ "apply", "--whitespace=nowarn", patchPath ]);
    writeState(repo, { version, from: version, baseTree, oldTree: baseTree, files: paths });
    return repo;
}

/**
 * Creates `repo` holding `paths` from each release in turn, staged one after the other so that
 * every release's blobs are in the object store. Returns the tree of each release.
 */
function initRepo(repo, paths, releases) {
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    git(repo, [ "init", "-q" ]);
    git(repo, [ "config", "core.autocrlf", "false" ]);
    const trees = [];
    for (const release of releases) {
        for (const path of paths) {
            const source = join(release, path);
            const target = join(repo, path);
            if (existsSync(source)) {
                mkdirSync(dirname(target), { recursive: true });
                copyFileSync(source, target);
            } else {
                rmSync(target, { force: true });
            }
        }
        git(repo, [ "add", "-A" ]);
        trees.push(git(repo, [ "write-tree" ]).stdout.trim());
    }
    return trees;
}

function diffPatch(repo, state) {
    return git(repo, [ ...DIFF_OPTIONS, state.baseTree, "--", ...state.files ],
        { encoding: "buffer" }).stdout;
}

/**
 * Whether the working tree differs from the version's patch file in the workspace. Without that
 * file, only a rebased repo counts: an opened one belongs to a patch that an upgrade replaced.
 */
function hasUnsavedEdits(repo) {
    const state = readState(repo, { isOptional: true });
    if (!state) return false;
    if (state.files.some((path) => hasConflictMarkers(join(repo, path)))) return true;
    const patchPath = join(ROOT, "patches", `@excalidraw__excalidraw@${state.version}.patch`);
    if (!existsSync(patchPath)) {
        return state.from !== state.version && diffPatch(repo, state).length > 0;
    }
    return !readFileSync(patchPath).equals(diffPatch(repo, state));
}

function repoDir(version) {
    return join(WORK_DIR, "repos", version);
}

function readState(repo, { isOptional = false } = {}) {
    const file = join(repo, ".git", "trilium-patch.json");
    if (!existsSync(file)) {
        if (isOptional) return null;
        fail(`No scratch repo at ${repo}: run \`open\` or \`rebase\` first.`);
    }
    return JSON.parse(readFileSync(file, "utf8"));
}

function writeState(repo, state) {
    writeFileSync(join(repo, ".git", "trilium-patch.json"), JSON.stringify(state, null, 4));
}

function readActiveVersion() {
    const file = join(WORK_DIR, "active.json");
    if (!existsSync(file)) fail(`No scratch repo under ${WORK_DIR}: run \`open\` first.`);
    return JSON.parse(readFileSync(file, "utf8")).version;
}

function setActiveVersion(version) {
    mkdirSync(WORK_DIR, { recursive: true });
    writeFileSync(join(WORK_DIR, "active.json"), JSON.stringify({ version }));
}

// --- Releases ---------------------------------------------------------------------------------

/** The `package/` folder of a release, downloaded once and checked against its integrity. */
async function fetchRelease(version) {
    const dir = join(WORK_DIR, "releases", version);
    if (existsSync(join(dir, ".complete"))) return join(dir, "package");

    const response = await fetch(`${REGISTRY}/${PACKAGE}/${version}`);
    if (!response.ok) fail(`The registry has no ${PACKAGE}@${version} (${response.status}).`);
    const { dist } = await response.json();
    const tarball = Buffer.from(await (await fetch(dist.tarball)).arrayBuffer());
    const separator = dist.integrity.indexOf("-");
    const digest = createHash(dist.integrity.slice(0, separator)).update(tarball).digest("base64");
    if (digest !== dist.integrity.slice(separator + 1)) {
        fail(`${dist.tarball} does not match its integrity.`);
    }

    rmSync(dir, { recursive: true, force: true });
    for (const { name, body } of readTar(gunzipSync(tarball))) {
        const target = resolve(dir, name);
        if (!target.startsWith(dir + sep)) continue;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
    }
    writeFileSync(join(dir, ".complete"), "");
    return join(dir, "package");
}

/** The regular files of a ustar archive, with pax and GNU long names. */
function* readTar(archive) {
    let longName = null;
    for (let offset = 0; offset + 512 <= archive.length;) {
        const header = archive.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const field = (start, length) =>
            header.subarray(start, start + length).toString("utf8").replace(/\0[\s\S]*$/, "");
        const size = parseInt(field(124, 12).trim() || "0", 8);
        const type = field(156, 1);
        const prefix = field(345, 155);
        const body = archive.subarray(offset + 512, offset + 512 + size);
        offset += 512 + Math.ceil(size / 512) * 512;

        if (type === "x") {
            longName = body.toString("utf8").match(/(?:^|\n)\d+ path=([^\n]*)\n/)?.[1] ?? null;
        } else if (type === "L") {
            longName = body.toString("utf8").replace(/\0[\s\S]*$/, "");
        } else if (type === "0" || type === "") {
            const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
            yield { name: longName ?? name, body };
            longName = null;
        }
    }
}

// --- Workspace --------------------------------------------------------------------------------

/** The `patchedDependencies` entry of `pnpm-workspace.yaml`. */
function readWorkspaceEntry() {
    const text = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
    const match = text.match(/^[ \t]+'?@excalidraw\/excalidraw@([^':\s]+)'?:[ \t]*(\S+)[ \t]*$/m);
    if (!match) fail(`pnpm-workspace.yaml patches no version of ${PACKAGE}.`);
    return { version: match[1], patchPath: join(ROOT, match[2]), line: match[0] };
}

/** Every package.json of the workspace that depends on the package, with the version it pins. */
function findPins() {
    const files = [ "package.json" ];
    for (const group of [ "apps", "packages" ]) {
        for (const name of readdirSync(join(ROOT, group))) {
            if (existsSync(join(ROOT, group, name, "package.json"))) {
                files.push(`${group}/${name}/package.json`);
            }
        }
    }
    const pins = [];
    for (const path of files) {
        const json = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
        const pin = json.dependencies?.[PACKAGE] ?? json.devDependencies?.[PACKAGE];
        if (pin) pins.push({ path, pin });
    }
    return pins;
}

function readLockfileHash(lockfile, version) {
    const key = `'@excalidraw/excalidraw@${version}':`;
    return lockfile.match(new RegExp(`${escapeRegExp(key)}\\s*(?:hash:\\s*)?([0-9a-f]{64})`))?.[1]
        ?? null;
}

function readInstalledVersion() {
    const file = join(ROOT, "node_modules", PACKAGE, "package.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
}

// --- Word diffs -------------------------------------------------------------------------------

/** The hunks of `git diff --word-diff=porcelain`, as runs of kept, removed and added text. */
function parseWordDiff(out) {
    const hunks = [];
    let hunk = null;
    for (const line of out.split("\n")) {
        if (line.startsWith("@@")) {
            const [ , range, where ] = line.match(/^(@@[^@]*@@) ?(.*)$/) ?? [ , line, "" ];
            hunk = { header: `${range} ${where.length > 60 ? `${where.slice(0, 60)}…` : where}`,
                segments: [] };
            hunks.push(hunk);
        } else if (hunk && (line === "~" || /^[ +-]/.test(line))) {
            const segment = line === "~"
                ? { type: " ", text: "\n" } : { type: line[0], text: line.slice(1) };
            const last = hunk.segments.at(-1);
            if (last?.type === segment.type) {
                last.text += segment.text;
            } else {
                hunk.segments.push(segment);
            }
        }
    }
    return hunks;
}

/** Marks changes as `[-removed-]{+added+}`, keeping `context` characters of kept text around. */
function renderWordHunk(segments, context) {
    let text = "";
    for (const [ index, { type, text: part } ] of segments.entries()) {
        if (type === "-") {
            text += `[-${part}-]`;
        } else if (type === "+") {
            text += `{+${part}+}`;
        } else if (index === 0) {
            text += part.length > context ? `…${part.slice(-context)}` : part;
        } else if (index === segments.length - 1) {
            text += part.length > context ? `${part.slice(0, context)}…` : part;
        } else {
            text += part.length > 2 * context + 3
                ? `${part.slice(0, context)} … ${part.slice(-context)}` : part;
        }
    }
    return text.replace(/\n+$/, "");
}

// --- Helpers ----------------------------------------------------------------------------------

function git(repo, args, { encoding = "utf8", isFailureAllowed = false } = {}) {
    const result = spawnSync("git", [ "-C", repo, "-c", "core.autocrlf=false", ...args ], {
        encoding, maxBuffer: 1 << 28
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && !isFailureAllowed) {
        fail(`git ${args[0]} failed:\n${result.stderr.toString()}`);
    }
    return result;
}

function parsePatch(text) {
    const files = [ ...text.matchAll(/^diff --git a\/(\S+) b\/\S+\nindex (\w+)\.\.(\w+)/gm) ]
        .map(([ , path, before, after ]) => ({ path, before, after }));
    if (files.length !== count(text, "\ndiff --git ") + (text.startsWith("diff --git ") ? 1 : 0)) {
        fail("The patch adds, deletes or renames a file, which this script does not handle.");
    }
    return files;
}

function hasConflictMarkers(file) {
    return existsSync(file) && /^(<{7}|>{7}) /m.test(readFileSync(file, "utf8"));
}

function isMinified(file) {
    return readFileSync(file, "utf8").split("\n")
        .some((line) => line.length > MINIFIED_LINE_LENGTH);
}

function blobId(content) {
    return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}

function count(text, part) {
    return text.split(part).length - 1;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rel(path) {
    return relative(ROOT, path).replaceAll("\\", "/");
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
