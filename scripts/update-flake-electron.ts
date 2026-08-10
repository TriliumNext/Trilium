/**
 * Keeps the Electron binary pinned in `flake.nix` in sync with the version
 * `apps/desktop/package.json` depends on.
 *
 * nixpkgs lags behind the Electron releases Trilium tracks, so the flake builds
 * the exact pinned version from Electron's official binary release rather than
 * taking `pkgs.electron_<major>` (see the comment above `pinnedElectronVersion`).
 * Every Electron bump therefore has to be mirrored into the flake, or it refuses
 * to evaluate:
 *
 *   error: flake.nix pins Electron 43.2.0, but apps/desktop/package.json wants 43.3.0
 *
 * This script is that mirroring, automated: it reads the wanted version, takes
 * the five per-platform zip checksums from the release's own `SHASUMS256.txt`,
 * computes the headers hash with `nix-prefetch-url`, and rewrites both
 * `pinnedElectron*` bindings. It is a no-op when the pin already matches, so it
 * is safe to run on a schedule.
 *
 * Run on demand or from the `update-nix-flake.yml` workflow, which opens a PR when
 * the flake changes. Usage:
 *
 *   pnpm chore:update-flake-electron
 *
 * Requires `nix-prefetch-url` on PATH — the headers hash is a NAR hash of the
 * unpacked tarball, which only Nix can compute.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const FLAKE_PATH = join(ROOT, "flake.nix");
const DESKTOP_PACKAGE_JSON_PATH = join(ROOT, "apps", "desktop", "package.json");

export async function main() {
    const flake = readFileSync(FLAKE_PATH, "utf-8");
    const wanted = readWantedElectronVersion(readFileSync(DESKTOP_PACKAGE_JSON_PATH, "utf-8"));
    const pinned = readPinnedElectronVersion(flake);

    if (wanted === pinned) {
        console.log(`flake.nix already pins Electron ${pinned}; nothing to do.`);
        return;
    }

    console.log(`Electron ${pinned} -> ${wanted}; refreshing the pin.`);
    const hashes = {
        ...parseShasums(await fetchShasums(wanted), wanted),
        headers: prefetchHeadersHash(wanted)
    };

    writeFileSync(FLAKE_PATH, rewriteFlake(flake, wanted, hashes));
    console.log(`Wrote ${FLAKE_PATH}`);
    for (const [ key, hash ] of Object.entries(hashes)) {
        console.log(`  ${key} = ${hash}`);
    }
}

/**
 * Nix system → the tag Electron uses in its release asset names, in the order the
 * generated `pinnedElectronHashes` block lists them. Mirrors `tags` in nixpkgs'
 * `pkgs/development/tools/electron/binary/generic.nix`, which is the builder the
 * flake reuses, so the set of systems here is exactly the set that builder covers.
 */
export const ELECTRON_PLATFORM_TAGS: Record<string, string> = {
    "x86_64-linux": "linux-x64",
    "armv7l-linux": "linux-armv7l",
    "aarch64-linux": "linux-arm64",
    "x86_64-darwin": "darwin-x64",
    "aarch64-darwin": "darwin-arm64"
};

/** Per-platform zip checksums plus the `headers` NAR hash, keyed as the flake expects. */
export type ElectronHashes = Record<string, string> & { headers: string };

/**
 * The flake pins one exact build, so a range (`^43.3.0`) has no single answer —
 * refuse rather than guess at what the lockfile happens to resolve to today.
 */
export function readWantedElectronVersion(packageJson: string): string {
    const version = JSON.parse(packageJson)?.devDependencies?.electron;
    if (typeof version !== "string") {
        throw new Error("apps/desktop/package.json has no devDependencies.electron entry.");
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(
            `apps/desktop/package.json must pin an exact Electron version, found "${version}".`
        );
    }
    return version;
}

export function readPinnedElectronVersion(flake: string): string {
    const match = flake.match(/^\s*pinnedElectronVersion = "([^"]+)";$/m);
    if (!match) {
        throw new Error("Could not find the pinnedElectronVersion binding in flake.nix.");
    }
    return match[1];
}

async function fetchShasums(version: string): Promise<string> {
    const url = `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch ${url}: HTTP ${response.status}. Is Electron ${version} released?`
        );
    }
    return response.text();
}

/**
 * Pull the five zip checksums out of a release's `SHASUMS256.txt`, whose lines are
 * `<sha256> *<asset name>`. The file also lists chromedriver, symbol and mas
 * builds, so match asset names exactly rather than by substring.
 */
export function parseShasums(shasums: string, version: string): Record<string, string> {
    const byAsset = new Map<string, string>();
    for (const line of shasums.split("\n")) {
        const match = line.match(/^([0-9a-f]{64}) \*(.+)$/);
        if (match) {
            byAsset.set(match[2].trim(), match[1]);
        }
    }

    const hashes: Record<string, string> = {};
    const missing: string[] = [];
    for (const [ system, tag ] of Object.entries(ELECTRON_PLATFORM_TAGS)) {
        const asset = `electron-v${version}-${tag}.zip`;
        const hash = byAsset.get(asset);
        if (hash) {
            hashes[system] = hash;
        } else {
            missing.push(asset);
        }
    }
    if (missing.length > 0) {
        throw new Error(`SHASUMS256.txt for Electron ${version} is missing: ${missing.join(", ")}`);
    }
    return hashes;
}

/**
 * The headers are consumed with `fetchzip`, so the flake needs the NAR hash of the
 * *unpacked* tarball rather than its sha256 — hence shelling out to Nix.
 */
function prefetchHeadersHash(version: string): string {
    const tarball = `node-v${version}-headers.tar.gz`;
    const url = `https://artifacts.electronjs.org/headers/dist/v${version}/${tarball}`;
    try {
        return execFileSync("nix-prefetch-url", [ "--unpack", url ], { encoding: "utf-8" }).trim();
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(
                "nix-prefetch-url is not on PATH; install Nix to refresh the headers hash."
            );
        }
        throw err;
    }
}

export function rewriteFlake(flake: string, version: string, hashes: ElectronHashes): string {
    const versionPattern = /^([ \t]*)pinnedElectronVersion = "[^"]*";$/m;
    const hashesPattern = /^([ \t]*)pinnedElectronHashes = \{[\s\S]*?^\1\};$/m;
    if (!versionPattern.test(flake) || !hashesPattern.test(flake)) {
        throw new Error(
            "Could not find the pinnedElectronVersion/pinnedElectronHashes bindings in flake.nix."
        );
    }

    return flake
        .replace(
            versionPattern,
            (_match, indent: string) => `${indent}pinnedElectronVersion = "${version}";`
        )
        .replace(hashesPattern, (_match, indent: string) => renderHashesBlock(indent, hashes));
}

function renderHashesBlock(indent: string, hashes: ElectronHashes): string {
    const inner = `${indent}  `;
    const lines = Object.keys(ELECTRON_PLATFORM_TAGS)
        .map((system) => `${inner}${system} = "${hashes[system]}";`);
    lines.push(`${inner}headers = "${hashes.headers}";`);
    return `${indent}pinnedElectronHashes = {\n${lines.join("\n")}\n${indent}};`;
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
