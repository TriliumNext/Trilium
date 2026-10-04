/**
 * Writes the Flathub packaging repo's manifest, launch wrapper and bot config
 * from their vendored sources in `apps/desktop/flatpak/`, with the git source
 * pinned to the requested ref and its pnpm sources tracking that ref's
 * `packageManager`. The desktop file and metainfo install from the pinned
 * checkout itself; `generated-sources.json` is a separate step:
 * ./scripts/flatpak/generate-sources.mts, run against the same ref's checkout.
 * Whatever else the packaging repo still tracks is removed, so the pull request
 * carries away an older recipe's leftovers rather than leaving them behind.
 *
 * Usage:
 *
 *   pnpm exec tsx ./scripts/flatpak/update-repo.mts <packaging-repo-dir> [ref]
 *
 * `ref` defaults to HEAD; a tag pins `tag:` and `commit:`, anything else pins
 * the bare commit (the beta case). The vendored manifest carries a
 * `__PLACEHOLDER__` for every value this fills in, so it holds no pin of its
 * own to fall behind the repository.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "../..");
const FLATPAK_DIR = join(REPO_ROOT, "apps/desktop/flatpak");
const MANIFEST_NAME = "org.triliumnotes.Trilium.yml";
// The wrapper is a manifest source; flathub.json configures Flathub's bots and
// only takes effect on the packaging repo's default branch.
const COPIED_FILES = [ "trilium.sh", "flathub.json" ];
// Everything else tracked in the packaging repo is a leftover of an older recipe.
// generate-sources.mts writes the sources file; the other two are the repo's own.
const KEPT_FILES = [ MANIFEST_NAME, ...COPIED_FILES, "generated-sources.json", "README.md", ".gitignore" ];
const MIN_PNPM_MAJOR = 12;

export async function main(argv: string[]) {
    const [repoDirArg, ref = "HEAD"] = argv;
    if (!repoDirArg || !statSync(resolve(repoDirArg), { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error("Pass the packaging repo checkout to update.");
    }
    const repoDir = resolve(repoDirArg);

    const commit = git("rev-parse", `${ref}^{commit}`);
    const tag = isTag(ref) ? ref : undefined;

    let manifest = updateGitSource(readFileSync(join(FLATPAK_DIR, MANIFEST_NAME), "utf-8"), commit, tag);

    const pnpmVersion = parsePnpmVersion(git("show", `${commit}:package.json`));
    checkPnpmSupported(pnpmVersion);
    manifest = updatePnpmPins(manifest, pnpmVersion, {
        x64: await sha256OfUrl(pnpmExeUrl("x64", pnpmVersion)),
        arm64: await sha256OfUrl(pnpmExeUrl("arm64", pnpmVersion))
    });
    checkPlaceholdersFilled(manifest);

    writeFileSync(join(repoDir, MANIFEST_NAME), manifest);
    for (const file of COPIED_FILES) {
        copyFileSync(join(FLATPAK_DIR, file), join(repoDir, file));
    }
    // `git ls-files` keeps listing a deletion that is staged but not committed, so a
    // re-run against the same checkout finds the file already gone.
    for (const file of selectStaleFiles(gitIn(repoDir, "ls-files"))) {
        if (existsSync(join(repoDir, file))) {
            rmSync(join(repoDir, file));
            console.log(`Removed ${file}, which the recipe no longer owns.`);
        }
    }
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, formatOutputs(commit, tag, pnpmVersion));
    }
    console.log(`Updated ${repoDir}: ${tag ?? "beta"} @ ${commit}, pnpm ${pnpmVersion}.`);
}

/**
 * The tracked files the recipe no longer writes, so a pull request removes them instead
 * of leaving an older recipe's leftovers behind — `master` still carries the build-time
 * scripts from before the manifest ran the checkout's own copies.
 */
export function selectStaleFiles(trackedFiles: string): string[] {
    return trackedFiles.split("\n")
        .map((file) => file.trim())
        .filter((file) => file && !KEPT_FILES.includes(file));
}

/** Step outputs for the workflow that opens the pull request; the tag is empty for a beta. */
export function formatOutputs(commit: string, tag: string | undefined, pnpmVersion: string): string {
    return `commit=${commit}\nshort=${commit.slice(0, 8)}\ntag=${tag ?? ""}\npnpm=${pnpmVersion}\n`;
}

/** Pins the manifest's git source; without a tag, the `tag:` line goes (a beta builds a bare commit). */
export function updateGitSource(manifest: string, commit: string, tag?: string): string {
    const tagLine = /^[ \t]*tag: __TAG__\n/m;
    if (!tagLine.test(manifest) || !manifest.includes("__COMMIT__")) {
        throw new Error("Found no Trilium git source to pin in the manifest.");
    }
    const tagged = tag ? manifest.replace("__TAG__", tag) : manifest.replace(tagLine, "");
    return tagged.replace("__COMMIT__", commit);
}

/** Catches a placeholder added to the manifest that nothing here fills in. */
export function checkPlaceholdersFilled(manifest: string) {
    const left = /__[A-Z0-9_]+__/.exec(manifest);
    if (left) {
        throw new Error(`The manifest still holds ${left[0]}, which nothing fills in.`);
    }
}

/**
 * The manifest pins pnpm per architecture, from the `@pnpm/exe.*` packages pnpm
 * publishes since 12. Older refs pinned one wrapper tarball, whose URL this
 * would otherwise build and fetch to a bare 404.
 */
export function checkPnpmSupported(version: string) {
    if (Number(version.split(".")[0]) < MIN_PNPM_MAJOR) {
        throw new Error(`The ref pins pnpm ${version}; the manifest's per-architecture `
            + `sources need pnpm ${MIN_PNPM_MAJOR} or newer.`);
    }
}

export function parsePnpmVersion(packageJson: string): string {
    const { packageManager } = JSON.parse(packageJson);
    const version = /^pnpm@([\d.]+)/.exec(packageManager ?? "")?.[1];
    if (!version) {
        throw new Error(`Expected package.json to pin pnpm, got "${packageManager}".`);
    }
    return version;
}

export function updatePnpmPins(
    manifest: string,
    version: string,
    hashes: { x64: string; arm64: string }
): string {
    const pins = {
        __PNPM_VERSION__: version,
        __PNPM_SHA256_X64__: hashes.x64,
        __PNPM_SHA256_ARM64__: hashes.arm64
    };
    let updated = manifest;
    for (const [placeholder, value] of Object.entries(pins)) {
        if (!updated.includes(placeholder)) {
            throw new Error(`Found no ${placeholder} to fill in the manifest.`);
        }
        updated = updated.replaceAll(placeholder, value);
    }
    return updated;
}

function pnpmExeUrl(arch: "x64" | "arm64", version: string): string {
    return `https://registry.npmjs.org/@pnpm/exe.linux-${arch}/-/exe.linux-${arch}-${version}.tgz`;
}

async function sha256OfUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} fetching ${url}`);
    }
    return createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
}

function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: REPO_ROOT }).toString().trim();
}

function gitIn(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd }).toString().trim();
}

function isTag(ref: string): boolean {
    try {
        git("show-ref", "--verify", "--quiet", `refs/tags/${ref}`);
        return true;
    } catch {
        return false;
    }
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === import.meta.filename) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
