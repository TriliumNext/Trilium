/**
 * Records the Chromium locale files the pinned Electron release ships, for the
 * `trim-locales.spec.ts` fixture in `apps/desktop/electron-forge/`.
 *
 * `trimElectronLocales` keeps the locale files whose names match an
 * `electronLocale` in `LOCALES` and fails the packaging when one is missing, so
 * its spec runs against the file names a real Electron build carries rather than
 * a hand-kept list. The desktop unit tests never download Electron, so this
 * script reads the names once per Electron version and commits them as
 * `electron-locales.json`; the spec fails when that file names a version other
 * than the one `apps/desktop/package.json` pins.
 *
 * Only the central directory at the end of each release zip is fetched, through
 * HTTP range requests, so a run transfers a few hundred kilobytes instead of
 * three ~130 MB archives. It is a no-op when the recorded version already
 * matches. Usage:
 *
 *   pnpm chore:update-electron-locales
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readWantedElectronVersion } from "./update-flake-electron.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DESKTOP_PACKAGE_JSON_PATH = join(ROOT, "apps", "desktop", "package.json");
const FIXTURE_PATH = join(ROOT, "apps", "desktop", "electron-forge", "electron-locales.json");

/**
 * The zip comment is at most 65,535 bytes, so the end-of-central-directory
 * record lies within this many bytes of the end.
 */
const EOCD_SEARCH_LENGTH = 22 + 0xffff;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

const PAK_PATTERN = /^locales\/([^/]+\.pak)$/;
const MAC_RESOURCES_PATTERN = /^Electron\.app\/Contents\/Resources\/([^/]+\.lproj)\//;
// `Electron Framework.framework/Resources` is a symlink into the current version.
const MAC_FRAMEWORK_RESOURCES_PATTERN = new RegExp(
    "^Electron\\.app/Contents/Frameworks/Electron Framework\\.framework/Versions/A/Resources/"
    + "([^/]+\\.lproj)/"
);

export interface ElectronLocales {
    electronVersion: string;
    /** The `.pak` files under `locales/` in the Linux zip. */
    linux: string[];
    /** The `.pak` files under `locales/` in the Windows zip. */
    win32: string[];
    darwin: {
        /** The `.lproj` directories under `Electron.app/Contents/Resources`. */
        resources: string[];
        /** The `.lproj` directories under `Electron Framework.framework/Resources`. */
        frameworkResources: string[];
    };
}

export async function main() {
    const wanted = readWantedElectronVersion(readFileSync(DESKTOP_PACKAGE_JSON_PATH, "utf-8"));
    const recorded = readRecordedVersion();
    if (wanted === recorded) {
        console.log(`electron-locales.json already lists Electron ${recorded}; nothing to do.`);
        return;
    }

    console.log(`Electron ${recorded ?? "(none)"} -> ${wanted}; reading the release zips.`);
    const [ linux, win32, darwin ] = await Promise.all([
        listZipEntries(releaseZipUrl(wanted, "linux-x64")),
        listZipEntries(releaseZipUrl(wanted, "win32-x64")),
        listZipEntries(releaseZipUrl(wanted, "darwin-arm64"))
    ]);

    const locales = collectElectronLocales(wanted, { linux, win32, darwin });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(locales, null, 4)}\n`);
    console.log(`Wrote ${FIXTURE_PATH}`);
}

/**
 * Pick the locale files out of each platform's zip entry names. Throw when a
 * platform yields none: an empty list means Electron moved its locales, and a
 * fixture without them would let the spec pass against nothing.
 */
export function collectElectronLocales(
    electronVersion: string,
    entries: { linux: string[]; win32: string[]; darwin: string[] }
): ElectronLocales {
    const locales: ElectronLocales = {
        electronVersion,
        linux: matchEntries(entries.linux, PAK_PATTERN),
        win32: matchEntries(entries.win32, PAK_PATTERN),
        darwin: {
            resources: matchEntries(entries.darwin, MAC_RESOURCES_PATTERN),
            frameworkResources: matchEntries(entries.darwin, MAC_FRAMEWORK_RESOURCES_PATTERN)
        }
    };

    const empty = [
        [ "linux", locales.linux ],
        [ "win32", locales.win32 ],
        [ "darwin resources", locales.darwin.resources ],
        [ "darwin framework resources", locales.darwin.frameworkResources ]
    ].filter(([ , names ]) => names.length === 0).map(([ platform ]) => platform);
    if (empty.length > 0) {
        throw new Error(
            `Found no locale files in the Electron ${electronVersion} zips for: ${empty.join(", ")}`
        );
    }
    return locales;
}

/** The distinct first capture group of every matching entry, sorted. */
function matchEntries(entries: string[], pattern: RegExp): string[] {
    const names = new Set<string>();
    for (const entry of entries) {
        const match = entry.match(pattern);
        if (match) {
            names.add(match[1]);
        }
    }
    return [ ...names ].sort();
}

/**
 * Find the end-of-central-directory record in the tail of a zip and return the
 * central directory's offset and size. ZIP64 archives store those in another
 * record; Electron's zips are far below its limits, so they are refused rather
 * than parsed.
 */
export function readEndOfCentralDirectory(tail: Uint8Array): { offset: number; size: number; } {
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    for (let position = tail.byteLength - 22; position >= 0; position--) {
        if (view.getUint32(position, true) !== EOCD_SIGNATURE) {
            continue;
        }
        const size = view.getUint32(position + 12, true);
        const offset = view.getUint32(position + 16, true);
        if (offset === 0xffffffff || size === 0xffffffff) {
            throw new Error("The zip is a ZIP64 archive, which is not supported.");
        }
        return { offset, size };
    }
    throw new Error("No end-of-central-directory record found; the file is not a zip.");
}

/** The file names listed in a zip's central directory, in archive order. */
export function readCentralDirectoryNames(centralDirectory: Uint8Array): string[] {
    const { buffer, byteOffset, byteLength } = centralDirectory;
    const view = new DataView(buffer, byteOffset, byteLength);
    const decoder = new TextDecoder();
    const names: string[] = [];
    let position = 0;
    while (position + 46 <= byteLength
        && view.getUint32(position, true) === CENTRAL_DIRECTORY_SIGNATURE) {
        const nameStart = position + 46;
        const nameLength = view.getUint16(position + 28, true);
        const extraLength = view.getUint16(position + 30, true);
        const commentLength = view.getUint16(position + 32, true);
        names.push(decoder.decode(centralDirectory.subarray(nameStart, nameStart + nameLength)));
        position = nameStart + nameLength + extraLength + commentLength;
    }
    if (position !== byteLength) {
        throw new Error(`The central directory ends in an unreadable record at byte ${position}.`);
    }
    return names;
}

function releaseZipUrl(version: string, platformTag: string): string {
    const release = `https://github.com/electron/electron/releases/download/v${version}`;
    return `${release}/electron-v${version}-${platformTag}.zip`;
}

async function listZipEntries(url: string): Promise<string[]> {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) {
        throw new Error(
            `Failed to fetch ${url}: HTTP ${head.status}. Is that Electron version released?`
        );
    }
    const length = Number(head.headers.get("content-length"));
    // The release host answers a suffix range (`bytes=-N`) with 501, so ask for explicit bytes.
    const tail = await fetchRange(url, Math.max(0, length - EOCD_SEARCH_LENGTH), length - 1);
    const { offset, size } = readEndOfCentralDirectory(tail);
    return readCentralDirectoryNames(await fetchRange(url, offset, offset + size - 1));
}

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
    const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (response.status !== 206) {
        throw new Error(
            `Expected bytes ${start}-${end} of ${url}, got HTTP ${response.status}.`
        );
    }
    return new Uint8Array(await response.arrayBuffer());
}

function readRecordedVersion(): string | undefined {
    try {
        return (JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as ElectronLocales).electronVersion;
    } catch {
        return undefined;
    }
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
