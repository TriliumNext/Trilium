/**
 * Builds the Flathub flatpak from this checkout's working tree and installs it for the
 * current user as org.triliumnotes.Trilium.Test, next to any install of the release.
 *
 * The manifest is the one ./scripts/flatpak/update-repo.mts writes for Flathub, with two
 * changes. Its git source becomes a `dir` source over this checkout: the build sees the
 * files on disk, uncommitted changes included, minus everything git ignores. `.git` stays
 * in, because the manifest stamps the build info from `git log`. And the app ID gains a
 * `.Test` suffix, so the build has its own launcher, data directory and autostart entry
 * instead of taking over the release's.
 * `generated-sources.json` is regenerated only when the lockfile changes.
 *
 * Usage:
 *
 *   pnpm exec tsx ./scripts/flatpak/build-local.mts
 *
 * Then run it with `flatpak run org.triliumnotes.Trilium.Test`.
 *
 * Builds through the org.flatpak.Builder flatpak. Without `flatpak-node-generator` on
 * PATH, the generator runs on that flatpak's Python from a flatpak-builder-tools
 * checkout under ~/.cache, cloned on first use.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { main as generateSources } from "./generate-sources.mjs";
import { MANIFEST_NAME, renderManifest, writePackagingFiles } from "./update-repo.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const OUT_DIR = join(REPO_ROOT, "apps/desktop/out/flathub");
const SOURCES_LOCKFILE_STAMP = join(OUT_DIR, "generated-sources.lockfile");
const APP_ID = "org.triliumnotes.Trilium";
const TEST_APP_ID = `${APP_ID}.Test`;
// Must match the commit .github/workflows/release-flathub.yml installs.
const GENERATOR_COMMIT = "41c20aa10819cdb2a4f3ca171758a96d1955c018";
const GENERATOR_REPO = "https://github.com/flatpak/flatpak-builder-tools.git";

export async function main() {
    checkNotWorktree();
    mkdirSync(OUT_DIR, { recursive: true });

    const { manifest } = await renderManifest("HEAD");
    const ignored = parseIgnoredPaths(execFileSync("git", [
        "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"
    ], { cwd: REPO_ROOT }).toString());
    writePackagingFiles(OUT_DIR, useTestAppId(useLocalDirSource(manifest, REPO_ROOT, ignored)));
    updateSources();

    // A Nix shell sets SOURCE_DATE_EPOCH to 1980, which would date the export, and flatpak
    // refuses to install a commit older than the installed one.
    const { SOURCE_DATE_EPOCH: _, ...env } = process.env;
    execFileSync("flatpak", [
        "run", "org.flatpak.Builder",
        "--user", "--install", "--force-clean", "--delete-build-dirs",
        "--install-deps-from=flathub",
        "builddir", MANIFEST_NAME
    ], { cwd: OUT_DIR, env, stdio: "inherit" });
    console.log(`Installed the working tree as ${TEST_APP_ID}.`);
}

/**
 * In a linked worktree, `.git` is a file pointing into the main checkout, which the build
 * sandbox cannot reach, so the manifest's `git log` would fail halfway through the build.
 */
function checkNotWorktree() {
    if (statSync(join(REPO_ROOT, ".git")).isFile()) {
        throw new Error("This checkout is a linked git worktree, whose .git file points "
            + "outside the build sandbox. Build from the main checkout instead.");
    }
}

/**
 * Replaces the manifest's Trilium git source with a `dir` source over a local checkout.
 * flatpak-builder matches `skip` entries as exact relative paths, not patterns, so each
 * ignored path is listed on its own.
 */
export function useLocalDirSource(manifest: string, repoDir: string, skip: string[]): string {
    const gitSource = new RegExp("^([ \\t]*)- type: git\\n"
        + "[ \\t]*url: https://github\\.com/TriliumNext/Trilium\\.git\\n"
        + "(?:[ \\t]*tag: .*\\n)?"
        + "[ \\t]*commit: .*\\n", "m");
    if (!gitSource.test(manifest)) {
        throw new Error("Found no Trilium git source to replace with the local checkout.");
    }
    return manifest.replace(gitSource, (_, indent: string) => [
        `${indent}- type: dir`,
        `${indent}  path: ${JSON.stringify(repoDir)}`,
        `${indent}  skip:`,
        ...skip.map((path) => `${indent}    - ${JSON.stringify(path)}`),
        ""
    ].join("\n"));
}

/**
 * Builds the app as TEST_APP_ID. The build commands install the desktop file, metainfo and
 * icons under the release's name, and flatpak-builder's `rename-*` options rename them and
 * the IDs inside them to the test app's.
 */
export function useTestAppId(manifest: string): string {
    const appIdLine = new RegExp(`^app-id: ${APP_ID.replaceAll(".", "\\.")}$`, "m");
    if (!appIdLine.test(manifest)) {
        throw new Error(`Found no "app-id: ${APP_ID}" line to rename.`);
    }
    return manifest
        .replace(appIdLine, [
            `app-id: ${TEST_APP_ID}`,
            `rename-desktop-file: ${APP_ID}.desktop`,
            `rename-appdata-file: ${APP_ID}.metainfo.xml`,
            `rename-icon: ${APP_ID}`,
            "desktop-file-name-suffix: \" (Test)\""
        ].join("\n"))
        .replaceAll("${FLATPAK_ID}", APP_ID);
}

/** NUL-separated `git ls-files -z --directory` output as paths, without those inside another. */
export function parseIgnoredPaths(lsFilesOutput: string): string[] {
    const paths = lsFilesOutput.split("\0")
        .filter(Boolean)
        .map((path) => path.replace(/\/$/, ""));
    return paths.filter((path) => !paths.some((other) => path.startsWith(`${other}/`)));
}

/** Regenerates the sources from the working tree's lockfile, unless it is unchanged. */
function updateSources() {
    const lockfileHash = createHash("sha256")
        .update(readFileSync(join(REPO_ROOT, "pnpm-lock.yaml")))
        .digest("hex");
    const sourcesPath = join(OUT_DIR, "generated-sources.json");
    if (existsSync(sourcesPath) && readStamp() === lockfileHash) {
        console.log("The lockfile is unchanged; reusing generated-sources.json.");
        return;
    }
    generateSources([ OUT_DIR ], generatorCommand());
    writeFileSync(SOURCES_LOCKFILE_STAMP, lockfileHash);
}

function readStamp() {
    return existsSync(SOURCES_LOCKFILE_STAMP)
        ? readFileSync(SOURCES_LOCKFILE_STAMP, "utf-8")
        : undefined;
}

function generatorCommand(): string[] {
    try {
        execFileSync("flatpak-node-generator", [ "--help" ], { stdio: "ignore" });
        return [ "flatpak-node-generator" ];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err;
        }
    }

    // org.flatpak.Builder sees the host's home directory but not its /tmp.
    const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    const checkout = join(cacheDir, "flatpak-builder-tools");
    checkOutGenerator(checkout);
    return [
        "flatpak", "run", "--command=python3", `--env=PYTHONPATH=${join(checkout, "node")}`,
        "org.flatpak.Builder", "-c", GENERATOR_BOOTSTRAP
    ];
}

/** Clones the generator on first use and moves an existing clone to GENERATOR_COMMIT. */
function checkOutGenerator(checkout: string) {
    if (!existsSync(checkout)) {
        execFileSync("git", [ "clone", "--quiet", GENERATOR_REPO, checkout ], { stdio: "inherit" });
    }
    const head = execFileSync("git", [ "-C", checkout, "rev-parse", "HEAD" ]).toString().trim();
    if (head === GENERATOR_COMMIT) {
        return;
    }
    execFileSync("git", [ "-C", checkout, "fetch", "--quiet", GENERATOR_REPO, GENERATOR_COMMIT ], {
        stdio: "inherit"
    });
    execFileSync("git", [ "-C", checkout, "checkout", "--quiet", "--detach", GENERATOR_COMMIT ], {
        stdio: "inherit"
    });
}

// The aiohttp in org.flatpak.Builder (3.10) rejects GitHub's release responses, whose
// headers exceed its 8190-byte default, so the generator's sessions get larger limits.
const GENERATOR_BOOTSTRAP = `\
import functools, runpy, aiohttp
aiohttp.ClientSession.__init__ = functools.partialmethod(
    aiohttp.ClientSession.__init__, max_line_size=65536, max_field_size=65536)
runpy.run_module("flatpak_node_generator", run_name="__main__", alter_sys=True)
`;

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === import.meta.filename) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
