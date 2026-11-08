/**
 * Walks through a release interactively:
 *
 *   1. checks that the branch is not behind `origin` and that every changelog entry lints;
 *   2. proposes the version from the changelog entries: a major release (0.106.1 → 0.107.0) when
 *      they hold a breaking change, a highlight, a compatibility change or a new feature, when the
 *      sync or database version changed, or when there are many of them; a minor one
 *      (0.106.1 → 0.106.2) for a few fixes;
 *   3. drafts the release note when there is none, registers it in `!!!meta.json`, warns about the
 *      entries changed after it, then consumes the entries and commits the note;
 *   4. sets the root `package.json` version, propagates it with `chore:update-version`, commits it
 *      and runs the release pre-flight check;
 *   5. tags the commit, pushes the branch and the tag, which starts the Release workflow;
 *   6. merges the tag into `stable` from a temporary worktree and pushes it.
 *
 * Each step checks what is already done, so a run that stopped halfway resumes where it left off.
 * Every commit names its paths, so other changes in the worktree stay out of it. Usage:
 *
 *   pnpm chore:release [--dry-run]
 *
 * `--dry-run` asks the same questions but prints the commands and writes that would change the
 * repository instead of running them.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { readChangelogEntries, readProtocolVersions, type Section } from "./release-notes.mts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const NOTES_DIR = join(ROOT, "docs", "Release Notes", "Release Notes");
const NOTES_META_PATH = join(ROOT, "docs", "Release Notes", "!!!meta.json");
const RELEASE_TEMPLATE_NOTE_ID = "wyurrlcDl416";
const PREFLIGHT_PATH = ".claude/skills/cutting-a-release/scripts/preflight-release-check.mts";
const RELEASE_WORKFLOW_URL = "https://github.com/TriliumNext/Trilium/actions/workflows/release.yml";
/** The files `chore:update-version` writes, root included. */
const VERSION_FILES = [
    "package.json",
    "apps/server/package.json",
    "apps/client/package.json",
    "apps/standalone/package.json",
    "apps/desktop/package.json",
    "apps/edit-docs/package.json",
    "packages/commons/package.json",
    "packages/pdfjs-viewer/package.json",
    "packages/trilium-core/package.json",
    "apps/desktop/flatpak/org.triliumnotes.Trilium.metainfo.xml"
];
/** From this many changelog entries on, a release is major whatever their sections. */
const HEAVY_RELEASE_ENTRIES = 15;
/** Sections that make a release major on their own. */
const MAJOR_SECTIONS = new Set<Section>([
    "Key highlights", "Breaking changes", "Compatibility", "Improvements", "Mobile improvements"
]);

export interface Version {
    major: number;
    minor: number;
    patch: number;
    /** The part after the hyphen of a pre-release, such as `rc.1`. */
    preRelease?: string;
}

export interface VersionSuggestion {
    version: string;
    kind: "major" | "minor";
    reasons: string[];
}

class Aborted extends Error {}

let dryRun = false;

async function main() {
    if (!process.stdin.isTTY) {
        throw new Error("The release CLI asks questions; run it in a terminal.");
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
        heading("Branch");
        checkBranch(branch);
        if (branch !== "main"
            && !await confirm(rl, `Releasing from ${branch} instead of main. Continue?`, false)) {
            throw new Aborted();
        }

        heading("Changelog entries");
        runReadOnly("node", [ "--experimental-strip-types", "scripts/release-notes.mts", "lint" ]);

        heading("Version");
        const version = await askVersion(rl);

        heading("Release note");
        await prepareReleaseNote(rl, version);

        heading("Package versions");
        await bumpVersions(rl, version);

        heading("Tag");
        await createTag(rl, version);

        heading("Push");
        await push(rl, branch, version);

        heading("Stable branch");
        await updateStable(rl, branch, version);

        console.log(`\nDone. Follow the build at ${RELEASE_WORKFLOW_URL}`);
    } finally {
        rl.close();
    }
}

/** Parses `0.107.0`, `v0.107.0` or `v0.107.0-rc.1`. */
export function parseVersion(text: string): Version | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(text.trim());
    if (!match) {
        return undefined;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        preRelease: match[4]
    };
}

export function formatVersion({ major, minor, patch, preRelease }: Version) {
    return `${major}.${minor}.${patch}${preRelease ? `-${preRelease}` : ""}`;
}

/** Orders versions the way semver does: a pre-release comes before its release. */
export function compareVersions(a: Version, b: Version) {
    const parts = (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
    if (parts !== 0 || a.preRelease === b.preRelease) {
        return parts;
    }
    if (!a.preRelease || !b.preRelease) {
        return a.preRelease ? -1 : 1;
    }
    return a.preRelease.localeCompare(b.preRelease, "en", { numeric: true });
}

/** The newest release among the tag names, pre-releases included. */
export function latestRelease(tags: string[]): Version | undefined {
    let latest: Version | undefined;
    for (const tag of tags) {
        const version = tag.startsWith("v") ? parseVersion(tag) : undefined;
        if (version && (!latest || compareVersions(version, latest) > 0)) {
            latest = version;
        }
    }
    return latest;
}

/**
 * Proposes the version after `previous` from the sections of the pending changelog entries. A
 * pre-release is followed by its own release.
 */
export function suggestVersion(previous: Version,
    { sections, protocolChanged }: { sections: Section[]; protocolChanged: boolean }
): VersionSuggestion {
    if (previous.preRelease) {
        return {
            version: formatVersion({ ...previous, preRelease: undefined }),
            kind: previous.patch === 0 ? "major" : "minor",
            reasons: [ `v${formatVersion(previous)} is a pre-release of it` ]
        };
    }

    const reasons: string[] = [];
    const counts = new Map<Section, number>();
    for (const section of sections) {
        counts.set(section, (counts.get(section) ?? 0) + 1);
    }
    for (const [ section, count ] of counts) {
        if (MAJOR_SECTIONS.has(section)) {
            reasons.push(`${section} (${count})`);
        }
    }
    if (protocolChanged) {
        reasons.push("the sync or database version changed");
    }
    if (sections.length >= HEAVY_RELEASE_ENTRIES) {
        reasons.push(`${sections.length} changelog entries`);
    }

    if (reasons.length > 0) {
        return {
            version: formatVersion({ major: previous.major, minor: previous.minor + 1, patch: 0 }),
            kind: "major",
            reasons
        };
    }
    return {
        version: formatVersion({ ...previous, patch: previous.patch + 1 }),
        kind: "minor",
        reasons: [ sections.length === 0
            ? "no changelog entries"
            : `only ${sections.length} ${sections.length === 1 ? "entry" : "entries"}, `
                + "with no feature, breaking or compatibility change" ]
    };
}

/** Replaces the top-level `"version"` of a `package.json`, keeping the rest of the text. */
export function setPackageVersion(source: string, version: string) {
    const pattern = /^(\s*"version":\s*")[^"]*(")/m;
    if (!pattern.test(source)) {
        throw new Error("Found no \"version\" in package.json.");
    }
    return source.replace(pattern, `$1${version}$2`);
}

/**
 * Adds the release note of `version` (`v0.107.0`) to the top of the Release Notes folder of
 * `!!!meta.json`, based on the Release Template, and moves the other notes down. Returns the source
 * unchanged when the note is already there.
 */
export function registerReleaseNote(source: string, version: string, noteId: string) {
    const meta = JSON.parse(source);
    const folder = meta.files?.[0];
    if (!folder?.children) {
        throw new Error("Found no Release Notes folder in !!!meta.json.");
    }

    const fileName = `${version}.md`;
    const children: { dataFileName?: string; notePosition: number }[] = folder.children;
    if (children.some((child) => child.dataFileName === fileName)) {
        return source;
    }

    for (const child of children) {
        child.notePosition += 10;
    }
    folder.children.unshift({
        isClone: false,
        noteId,
        notePath: [ folder.noteId, noteId ],
        title: version,
        notePosition: 10,
        prefix: null,
        isExpanded: false,
        type: "text",
        mime: "text/html",
        attributes: [ {
            type: "relation",
            name: "template",
            value: RELEASE_TEMPLATE_NOTE_ID,
            isInheritable: false,
            position: 60
        } ],
        format: "markdown",
        dataFileName: fileName,
        attachments: []
    });
    return JSON.stringify(meta, null, 4);
}

function checkBranch(branch: string) {
    if (branch === "HEAD") {
        throw new Error("HEAD is detached; check out the branch to release from.");
    }

    runReadOnly("git", [ "fetch", "--quiet", "--tags", "origin" ]);
    if (!revParse(`refs/remotes/origin/${branch}`)) {
        console.log(`origin has no ${branch} branch yet.`);
        return;
    }
    const behind = Number(git("rev-list", "--count", `HEAD..origin/${branch}`).trim());
    if (behind > 0) {
        throw new Error(`${branch} is ${behind} commits behind origin/${branch}; pull first.`);
    }
    console.log(`${branch} is up to date with origin/${branch}.`);
}

async function askVersion(rl: Interface) {
    const tags = git("tag", "--list", "v[0-9]*").split("\n");
    const previous = latestRelease(tags);
    if (!previous) {
        throw new Error("Found no release tags to compare with.");
    }

    const base = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD").trim();
    const before = readProtocolVersions(base);
    const after = readProtocolVersions("HEAD");
    const { entries } = readChangelogEntries();
    const suggestion = suggestVersion(previous, {
        sections: entries.map((entry) => entry.section),
        protocolChanged: before.sync !== after.sync || before.db !== after.db
    });

    console.log(`The latest release is v${formatVersion(previous)}.`);
    console.log(`Suggesting a ${suggestion.kind} release, v${suggestion.version}: `
        + `${suggestion.reasons.join(", ")}.`);
    let prefill = `v${suggestion.version}`;
    const draft = findDraft(previous);
    const headTag = latestRelease(
        git("tag", "--points-at", "HEAD", "--list", "v[0-9]*").split("\n"));
    if (headTag) {
        prefill = `v${formatVersion(headTag)}`;
        console.log(`HEAD is already tagged ${prefill}; resuming that release.`);
    } else if (draft && draft !== prefill) {
        console.log(`A release note is already drafted for ${draft}; proposing that instead.`);
        prefill = draft;
    }

    for (;;) {
        const answer = (await ask(rl, "Version", prefill)).trim();
        const version = parseVersion(answer);
        if (!version) {
            console.log("Expected a version such as v0.107.0 or v0.107.0-rc.1.");
            continue;
        }
        const tag = `v${formatVersion(version)}`;
        const tagged = revParse(`refs/tags/${tag}^{commit}`);
        if (tagged && tagged !== revParse("HEAD")) {
            console.log(`${tag} already tags another commit.`);
            continue;
        }
        if (!tagged && compareVersions(version, previous) <= 0) {
            console.log(`${tag} is not newer than v${formatVersion(previous)}.`);
            continue;
        }
        const markedLatest = version.preRelease && !version.preRelease.includes("rc");
        if (markedLatest && !await confirm(rl, "The Release workflow marks only tags containing "
            + `"rc" as a pre-release, so ${tag} would become the latest release. Use it anyway?`,
        false)) {
            continue;
        }
        return tag;
    }
}

/** The newest release note newer than `previous`, which a maintainer drafted ahead of the run. */
function findDraft(previous: Version) {
    let draft: Version | undefined;
    for (const name of readdirSync(NOTES_DIR)) {
        const version = name.endsWith(".md") ? parseVersion(name.slice(0, -3)) : undefined;
        if (version && compareVersions(version, previous) > 0
            && (!draft || compareVersions(version, draft) > 0)) {
            draft = version;
        }
    }
    return draft ? `v${formatVersion(draft)}` : undefined;
}

async function prepareReleaseNote(rl: Interface, version: string) {
    const notePath = join(NOTES_DIR, `${version}.md`);
    if (!existsSync(notePath)) {
        if (!await confirm(rl, `There is no release note for ${version}. `
            + "Draft it from the changelog?", true)) {
            throw new Aborted();
        }
        run("node", [ "--experimental-strip-types", "scripts/release-notes.mts", version,
            "--unlisted" ]);
        if (dryRun) {
            return;
        }
    }

    const meta = readFileSync(NOTES_META_PATH, "utf-8");
    const registered = registerReleaseNote(meta, version, randomNoteId());
    if (registered !== meta) {
        write(NOTES_META_PATH, registered, `register ${version} in the Release Notes folder`);
    }

    for (;;) {
        const noteChanged = lastChanged(notePath);
        const stale = readChangelogEntries().entries
            .filter((entry) => lastChanged(entry.file) > noteChanged);
        if (stale.length > 0) {
            console.log(`${stale.length} changelog entries changed after the release note:`);
            for (const entry of stale) {
                console.log(`  ${relative(ROOT, entry.file)}: ${entry.text.slice(0, 70)}`);
            }
        }
        if (await confirm(rl, `Is ${relative(ROOT, notePath)} final?`, stale.length === 0)) {
            break;
        }
        await ask(rl, "Edit it, then press Enter to check again", "");
    }

    const { entries } = readChangelogEntries();
    const entryPaths = entries.map((entry) => relative(ROOT, entry.file));
    const paths = [ "docs/Release Notes", ...entryPaths ];
    if (version.includes("-")) {
        paths.push(".changelog/pre-release");
    }
    const changed = changedPaths(paths);
    if (changed.length === 0 && entries.length === 0) {
        console.log("The release note is committed.");
        return;
    }

    console.log(`Committing the release note and consuming ${entries.length} changelog entries:`);
    for (const path of changed) {
        console.log(`  ${path}`);
    }
    if (!await confirm(rl, "Commit?", true)) {
        throw new Aborted();
    }
    if (entries.length > 0) {
        run("node", [ "--experimental-strip-types", "scripts/release-notes.mts", "consume",
            version ]);
    }
    commit(`docs(release): add the ${version} release notes`, paths);
}

async function bumpVersions(rl: Interface, version: string) {
    const dirty = changedPaths(VERSION_FILES);
    if (dirty.length > 0) {
        console.log("These files have uncommitted changes, which the version commit would take:");
        for (const path of dirty) {
            console.log(`  ${path}`);
        }
        if (!await confirm(rl, "Commit them with the version bump?", false)) {
            throw new Aborted();
        }
    }

    const packageVersion = version.slice(1);
    const rootPath = join(ROOT, "package.json");
    const root = readFileSync(rootPath, "utf-8");
    const updated = setPackageVersion(root, packageVersion);
    if (updated !== root) {
        write(rootPath, updated, `set the root version to ${packageVersion}`);
    }
    run("pnpm", [ "--silent", "chore:update-version" ]);

    const changed = changedPaths(VERSION_FILES);
    if (changed.length > 0 || dryRun) {
        if (!await confirm(rl, `Commit "chore(release): prepare for ${version}"?`, true)) {
            throw new Aborted();
        }
        commit(`chore(release): prepare for ${version}`, VERSION_FILES);
    } else {
        console.log(`Every package is already at ${packageVersion}.`);
    }

    if (dryRun) {
        console.log(`[dry-run] tsx ${PREFLIGHT_PATH} ${version}`);
    } else {
        runReadOnly("pnpm", [ "exec", "tsx", PREFLIGHT_PATH, version ]);
    }
}

async function createTag(rl: Interface, version: string) {
    const head = revParse("HEAD");
    if (revParse(`refs/tags/${version}^{commit}`) === head) {
        console.log(`${version} already tags HEAD.`);
        return;
    }
    const subject = git("log", "-1", "--format=%h %s", "HEAD").trim();
    if (!await confirm(rl, `Tag ${subject} as ${version}?`, true)) {
        throw new Aborted();
    }
    run("git", [ "tag", version ]);
}

async function push(rl: Interface, branch: string, version: string) {
    const remoteBranch = revParse(`refs/remotes/origin/${branch}`);
    const ahead = remoteBranch
        ? Number(git("rev-list", "--count", `origin/${branch}..HEAD`).trim()) : undefined;
    const tagPushed = git("ls-remote", "--tags", "origin", `refs/tags/${version}`).trim() !== "";
    if (ahead === 0 && tagPushed) {
        console.log(`${branch} and ${version} are on origin.`);
        return;
    }

    const refs: string[] = [];
    if (ahead !== 0) {
        refs.push(ahead === undefined
            ? `${branch} (new on origin)` : `${branch} (${ahead} commits)`);
    }
    if (!tagPushed) {
        refs.push(version);
    }
    if (!await confirm(rl, `Push ${refs.join(" and ")} to origin? `
        + "The tag starts the Release workflow.", true)) {
        throw new Aborted();
    }
    if (ahead !== 0) {
        run("git", [ "push", "origin", `HEAD:refs/heads/${branch}` ]);
    }
    if (!tagPushed) {
        run("git", [ "push", "origin", `refs/tags/${version}` ]);
    }
}

async function updateStable(rl: Interface, branch: string, version: string) {
    if (version.includes("-")) {
        console.log(`${version} is a pre-release, so stable stays where it is.`);
        return;
    }
    if (branch === "stable") {
        console.log("The release was made on stable, which is pushed.");
        return;
    }

    runReadOnly("git", [ "fetch", "--quiet", "origin", "stable" ]);
    const tagged = revParse(`refs/tags/${version}^{commit}`) ?? `refs/tags/${version}`;
    if (isAncestor(tagged, "origin/stable")) {
        console.log(`origin/stable already contains ${version}.`);
        return;
    }
    if (!await confirm(rl, `Merge ${version} into stable and push it?`, true)) {
        throw new Aborted();
    }

    if (isAncestor("origin/stable", tagged)) {
        run("git", [ "push", "origin", `${tagged}:refs/heads/stable` ]);
        return;
    }

    // The local `stable` can be checked out in another worktree, so the merge runs detached.
    const worktree = mkdtempSync(join(tmpdir(), "trilium-stable-"));
    rmSync(worktree, { recursive: true });
    run("git", [ "worktree", "add", "--quiet", "--detach", worktree, "origin/stable" ]);
    try {
        const message = `Merge tag '${version}' into stable`;
        const merged = dryRun || spawnSync("git",
            [ "merge", "--no-ff", "-m", message, `refs/tags/${version}` ],
            { cwd: worktree, stdio: "inherit" }).status === 0;
        if (!merged) {
            spawnSync("git", [ "merge", "--abort" ], { cwd: worktree, stdio: "inherit" });
            throw new Error(
                `Merging ${version} into stable conflicts; merge it by hand, then push.`);
        }
        run("git", [ "-C", worktree, "push", "origin", "HEAD:refs/heads/stable" ]);
    } finally {
        run("git", [ "worktree", "remove", "--force", worktree ]);
    }
    console.log("Pull stable in any worktree that has it checked out.");
}

/** The paths among `paths` (files or folders) that differ from `HEAD` or are untracked. */
function changedPaths(paths: string[]) {
    return git("status", "--porcelain", "-z", "--no-renames", "--untracked-files=all", "--",
        ...paths)
        .split("\0")
        .filter(Boolean)
        .map((line) => line.slice(3));
}

/** When the file last changed: its commit time, or its modification time while it is dirty. */
function lastChanged(path: string) {
    if (changedPaths([ relative(ROOT, path) ]).length > 0) {
        return statSync(path).mtimeMs / 1000;
    }
    return Number(git("log", "-1", "--format=%ct", "--", relative(ROOT, path)).trim() || 0);
}

/** Commits `paths` alone, whatever else the index holds. */
function commit(message: string, paths: string[]) {
    if (dryRun) {
        console.log(`[dry-run] git commit -m "${message}" -- (${paths.length} paths)`);
        return;
    }
    const messageDir = mkdtempSync(join(tmpdir(), "trilium-release-"));
    const messagePath = join(messageDir, "message.txt");
    writeFileSync(messagePath, `${message}\n`);
    try {
        const existing = paths.filter((path) => existsSync(join(ROOT, path))
            || git("ls-files", "--", path).trim() !== "");
        runReadOnly("git", [ "add", "--all", "--", ...existing ]);
        runReadOnly("git", [ "commit", "--quiet", "-F", messagePath, "--", ...existing ]);
        console.log(git("log", "-1", "--format=Committed %h %s", "HEAD").trim());
    } finally {
        rmSync(messageDir, { recursive: true });
    }
}

function randomNoteId() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 12; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

async function ask(rl: Interface, question: string, prefill: string) {
    const answer = rl.question(`${question}: `);
    rl.write(prefill);
    return answer;
}

async function confirm(rl: Interface, question: string, defaultYes: boolean) {
    const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `))
        .trim().toLowerCase();
    if (answer === "") {
        return defaultYes;
    }
    return answer === "y" || answer === "yes";
}

function heading(title: string) {
    console.log(`\n── ${title} ──`);
}

function write(path: string, content: string, description: string) {
    if (dryRun) {
        console.log(`[dry-run] ${description} (${relative(ROOT, path)})`);
        return;
    }
    writeFileSync(path, content);
    console.log(`Updated ${relative(ROOT, path)}: ${description}.`);
}

/** Runs a command that changes the repository; under `--dry-run`, prints it instead. */
function run(command: string, args: string[]) {
    if (dryRun) {
        console.log(`[dry-run] ${command} ${args.join(" ")}`);
        return;
    }
    runReadOnly(command, args);
}

/** Runs a command even under `--dry-run`, failing when it does. */
function runReadOnly(command: string, args: string[]) {
    const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed.`);
    }
}

function revParse(ref: string) {
    try {
        return git("rev-parse", "--quiet", "--verify", ref).trim() || undefined;
    } catch {
        return undefined;
    }
}

function isAncestor(ancestor: string, descendant: string) {
    return spawnSync("git", [ "merge-base", "--is-ancestor", ancestor, descendant ],
        { cwd: ROOT }).status === 0;
}

function git(...args: string[]) {
    return execFileSync("git", args, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: [ "ignore", "pipe", "pipe" ]
    });
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    dryRun = process.argv.includes("--dry-run");
    try {
        await main();
    } catch (err) {
        if (err instanceof Aborted) {
            console.error("Stopped. Run it again to pick up where it left off.");
        } else {
            console.error(err instanceof Error ? err.message : err);
        }
        process.exit(1);
    }
}
