/**
 * Generates the sources file that lets `pnpm install --offline` run inside the
 * flatpak-builder sandbox, which has no network.
 *
 * flatpak-builder downloads every input up front from the manifest, so each of the
 * ~2500 packages in `pnpm-lock.yaml` has to be declared as its own pinned source.
 * `flatpak-node-generator` performs that translation and additionally emits the
 * script that rebuilds pnpm's content-addressable store from the tarballs.
 *
 * Usage:
 *
 *   pnpm exec tsx ./scripts/flatpak/generate-sources.mts [output]
 *
 * `output` is the file to write, or a directory to write `generated-sources.json`
 * into — pass the packaging repo checkout to update its tracked copy in place.
 * Defaults to `upload/generated-sources.json`.
 *
 * Requires `flatpak-node-generator` on PATH, from the `node` subdirectory of
 * https://github.com/flatpak/flatpak-builder-tools.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const LOCKFILE_PATH = join(ROOT, "pnpm-lock.yaml");

const PNPM_MAJOR = 12;
// pnpm 12 still reads its store from the v11 layout (a SQLite index.db);
// flatpak-node-generator defaults to v10 (per-package JSON index files),
// which pnpm would not find.
const STORE_VERSION = "v11";

interface Source {
    dest?: string;
    url?: string;
    [key: string]: unknown;
}

export function main(argv: string[]) {
    const outputPath = resolveOutputPath(argv[0]);
    checkPnpm(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
    generateSources(outputPath);

    const sources: Source[] = JSON.parse(readFileSync(outputPath, "utf-8"));
    const kept = filterSources(sources);
    writeFileSync(outputPath, `${JSON.stringify(kept, null, 4)}\n`);
    console.log(`Wrote ${relative(process.cwd(), outputPath)}: `
        + `${kept.length} sources, ${sources.length - kept.length} dropped.`);
}

/** The file to write: the argument, `generated-sources.json` under an argument naming a directory, or the default. */
export function resolveOutputPath(arg: string | undefined): string {
    if (!arg) {
        return join(ROOT, "upload", "generated-sources.json");
    }
    const path = resolve(arg);
    return statSync(path, { throwIfNoEntry: false })?.isDirectory()
        ? join(path, "generated-sources.json")
        : path;
}

export function checkPnpm(packageJson: string) {
    const { packageManager } = JSON.parse(packageJson);
    const major = /^pnpm@(\d+)\./.exec(packageManager ?? "")?.[1];
    if (Number(major) !== PNPM_MAJOR) {
        throw new Error(
            `Expected package.json to pin pnpm ${PNPM_MAJOR}, got "${packageManager}". `
            + `Point STORE_VERSION at the layout the new pnpm uses: generating against the wrong `
            + `one succeeds here and only fails later, inside the build sandbox.`
        );
    }
}

/**
 * Drops the Playwright browser archives: nothing in the sandbox build can reach them,
 * and the generator supports no `--no-devel` for pnpm lockfile v9. The checks make
 * generator output drift fail here instead of inside the network-less flatpak build.
 */
export function filterSources(sources: Source[]): Source[] {
    const kept = sources.filter((s) => !s.dest?.startsWith("flatpak-node/cache/ms-playwright"));

    if (kept.length === sources.length) {
        throw new Error("Found no Playwright sources to drop. "
            + "Did flatpak-node-generator change its cache paths?");
    }
    if (kept.length < 2000) {
        throw new Error(`Only ${kept.length} sources left, expected around 2500.`);
    }
    if (!kept.some((s) => /electron-v[\d.]+-linux-x64\.zip$/.test(s.url ?? ""))) {
        throw new Error("No linux-x64 Electron zip among the sources. "
            + "The flatpak manifest unpacks it in place of the never-run Electron install script.");
    }
    return kept;
}

function generateSources(outputPath: string) {
    mkdirSync(dirname(outputPath), { recursive: true });
    try {
        execFileSync("flatpak-node-generator", [
            "pnpm", LOCKFILE_PATH,
            "--pnpm-store-version", STORE_VERSION,
            "-o", outputPath
        ], { stdio: "inherit" });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(
                "flatpak-node-generator is not on PATH. Install it with:\n"
                + "  pipx install 'git+https://github.com/flatpak/flatpak-builder-tools.git"
                + "#subdirectory=node'"
            );
        }
        throw err;
    }
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === import.meta.filename) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
