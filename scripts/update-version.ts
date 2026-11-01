/**
 * @module
 *
 * This script synchronizes the `package.json` version of the monorepo (root `package.json`)
 * into the apps, so that it is properly displayed. It also regenerates the Flathub
 * metainfo's `<releases>`, which decides the version Flathub displays: the manifest
 * installs that file from the tagged checkout, so the entry has to be in the commit that
 * gets tagged.
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = join(SCRIPT_PATH, "..", "..");
const METAINFO_PATH = join(ROOT, "apps", "desktop", "flatpak", "org.triliumnotes.Trilium.metainfo.xml");
const RELEASE_URL = "https://github.com/TriliumNext/Trilium/releases/tag/v";
const MAX_RELEASE_ENTRIES = 5;

export interface Release {
    version: string;
    date: string;
}

export function main() {
    const version = getVersion(join(ROOT, "package.json"));

    for (const appName of ["server", "client", "standalone", "desktop", "edit-docs"]) {
        patchPackageJson(join(ROOT, "apps", appName, "package.json"), version);
    }

    for (const packageName of ["commons", "pdfjs-viewer", "trilium-core"]) {
        patchPackageJson(join(ROOT, "packages", packageName, "package.json"), version);
    }

    const tags = parseReleaseTags(git("for-each-ref", "--sort=-creatordate",
        "--format=%(refname:short)\t%(creatordate:short)", "refs/tags/v*"));
    if (tags.length === 0) {
        throw new Error("Found no release tags to date the metainfo entries with.");
    }
    const releases = selectReleases(tags, version, new Date().toISOString().slice(0, 10));
    writeFileSync(METAINFO_PATH,
        renderMetainfoReleases(readFileSync(METAINFO_PATH, "utf-8"), releases));
}

/**
 * Reads `git for-each-ref` output, keeping the `vX.Y.Z` tags in the order given. The rc
 * and beta tags are releases Flathub never sees, and `v0.48`-style tags predate the
 * three-part scheme.
 */
export function parseReleaseTags(output: string): Release[] {
    const releases: Release[] = [];
    for (const line of output.split("\n")) {
        const tag = /^v(\d+\.\d+\.\d+)\t(\d{4}-\d{2}-\d{2})$/.exec(line.trim());
        if (tag) {
            releases.push({ version: tag[1], date: tag[2] });
        }
    }
    return releases;
}

/**
 * The newest MAX_RELEASE_ENTRIES releases, newest first. A version being prepared has no
 * tag yet, so it is dated `today` until the tag it is about to get supplies the date.
 */
export function selectReleases(tags: Release[], version: string, today: string): Release[] {
    const releases = tags.some((it) => it.version === version)
        ? tags : [ { version, date: today }, ...tags ];
    return releases.slice(0, MAX_RELEASE_ENTRIES);
}

/** Replaces the metainfo's `<releases>`, keeping the indentation the document uses. */
export function renderMetainfoReleases(metainfo: string, releases: Release[]): string {
    const block = /([ \t]*)<releases>\n[\s\S]*?[ \t]*<\/releases>/;
    if (!block.test(metainfo)) {
        throw new Error("Found no <releases> block in the metainfo.");
    }

    return metainfo.replace(block, (_, indent: string) => {
        const entries = releases.map(({ version, date }) =>
            `${indent}  <release version="${version}" date="${date}">\n`
            + `${indent}    <url type="details">${RELEASE_URL}${version}</url>\n`
            + `${indent}  </release>\n`);
        return `${indent}<releases>\n${entries.join("")}${indent}</releases>`;
    });
}

function patchPackageJson(packageJsonPath: string, version: string) {
    // Read the version from package.json and process it.
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    // Write the adjusted version back in.
    packageJson.version = version;
    const formattedJson = JSON.stringify(packageJson, null, 2);
    writeFileSync(packageJsonPath, formattedJson);
}

function getVersion(packageJsonPath: string) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
}

function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: ROOT }).toString();
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    main();
}
