/**
 * @module
 *
 * This script synchronizes the `package.json` version of the monorepo (root `package.json`)
 * into the apps, so that it is properly displayed. It also regenerates the Flathub
 * metainfo's `<releases>`, which decides the version Flathub displays: the manifest
 * installs that file from the tagged checkout, so the entry has to be in the commit that
 * gets tagged. Each entry carries the release's notes, taken from the overview of its
 * release note in `docs/Release Notes/Release Notes`.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = join(SCRIPT_PATH, "..", "..");
const METAINFO_PATH = join(ROOT, "apps", "desktop", "flatpak", "org.triliumnotes.Trilium.metainfo.xml");
const RELEASE_NOTES_DIR = join(ROOT, "docs", "Release Notes", "Release Notes");
const RELEASE_URL = "https://github.com/TriliumNext/Trilium/releases/tag/v";
const MAX_RELEASE_ENTRIES = 5;
const MAX_DESCRIPTION_ITEMS = 8;

export interface Release {
    version: string;
    date: string;
    description?: DescriptionBlock[];
}

/** A block of a release's AppStream description, its text already in AppStream markup. */
export type DescriptionBlock = { paragraph: string } | { items: string[] };

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
    const releases = selectReleases(tags, version, new Date().toISOString().slice(0, 10))
        .map((release) => ({ ...release, description: releaseDescription(readReleaseNotes(release.version)) }));
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
        const entries = releases.map(({ version, date, description }) =>
            `${indent}  <release version="${version}" date="${date}"${version.includes("-") ? " type=\"development\"" : ""}>\n`
            + renderDescription(description ?? [], `${indent}    `)
            + `${indent}    <url type="details">${RELEASE_URL}${version}</url>\n`
            + `${indent}  </release>\n`);
        return `${indent}<releases>\n${entries.join("")}${indent}</releases>`;
    });
}

/**
 * The notes Flathub shows for a release, from its release note: the overview paragraphs
 * above the first section. Notes written before the overview existed fall back to the titles
 * of their key highlights, and patch releases without highlights to their top-level entries.
 * The notes end with a change of the sync protocol or database version, which decides whether
 * the app still syncs with other instances and opens its database in an earlier version, and
 * with the number of improvements and bug fixes the release note lists.
 */
export function releaseDescription(markdown: string): DescriptionBlock[] {
    const lines = markdown.split("\n").slice(1);
    const endings = [ ...versionChanges(lines), describeChangeCount(lines) ]
        .filter((ending): ending is string => !!ending);
    const blocks = summarizeRelease(lines);
    const last = blocks.at(-1);
    if (last && "items" in last) {
        last.items.push(...endings);
    } else {
        blocks.push(...endings.map((paragraph) => ({ paragraph })));
    }
    return blocks;
}

/**
 * The Compatibility entries that `pnpm chore:release-notes` writes when the sync protocol or
 * the database version changed since the previous release.
 */
function versionChanges(lines: string[]): string[] {
    return lines
        .map((line) => /^(?:\d+\.|\*|-)\s+(The (?:sync protocol|database) version went from .*)$/
            .exec(line)?.[1])
        .filter((entry): entry is string => !!entry)
        .map(inlineMarkdown);
}

function summarizeRelease(lines: string[]): DescriptionBlock[] {
    const firstSection = lines.findIndex((line) => /^#{2,3} /.test(line));
    const overview = paragraphs(lines.slice(0, firstSection === -1 ? lines.length : firstSection))
        .filter((paragraph) => !/^[>*\-|!<]|^\d+\./.test(paragraph))
        .map((paragraph) => ({ paragraph: inlineMarkdown(paragraph.replace(/^_(.*)_$/s, "$1")) }));
    if (overview.length > 0) {
        return overview;
    }

    const highlights = lines.findIndex((line) => /^## .*Key highlights/.test(line));
    if (highlights !== -1) {
        const end = lines.findIndex((line, index) => index > highlights && line.startsWith("## "));
        const titles = lines.slice(highlights + 1, end === -1 ? lines.length : end)
            .filter((line) => line.startsWith("### "))
            .map((line) => inlineMarkdown(line.slice(4).replace(/^[^\p{L}\p{N}]+/u, "")
                .replace(/ by @[\w-]+( and @[\w-]+)*$/, "")))
            .filter((title) => !/^and others/i.test(title));
        return [ { items: titles.slice(0, MAX_DESCRIPTION_ITEMS) } ];
    }

    const entries = lines
        .map((line) => /^(?:\d+\.|\*|-)\s+(.*)$/.exec(line)?.[1])
        .filter((entry): entry is string => !!entry)
        .map((entry) => inlineMarkdown(entry).replace(/:$/, "."));
    return entries.length > 0 ? [ { items: entries.slice(0, MAX_DESCRIPTION_ITEMS) } ] : [];
}

/**
 * "Also in this release: …" with the number of entries under the Improvements, Mobile
 * improvements and Bugfixes sections: the count each collapsible area states in its summary,
 * plus the entries listed outside one.
 */
function describeChangeCount(lines: string[]): string | undefined {
    const counts = { improvement: 0, fix: 0 };
    let section: keyof typeof counts | undefined;
    for (const line of lines) {
        const heading = /^#{2,3} (.*)$/.exec(line)?.[1].replace(/^[^\p{L}]+/u, "");
        if (heading !== undefined) {
            section = /^bug ?fixes$/i.test(heading) ? "fix"
                : /^(mobile )?improvements$/i.test(heading) ? "improvement" : undefined;
        } else if (section) {
            const summaryCount = /<summary>.*\((\d+)\)<\/summary>/.exec(line)?.[1];
            counts[section] += summaryCount ? Number(summaryCount)
                : /^(?:\d+\.|\*|-)\s+/.test(line) ? 1 : 0;
        }
    }
    const parts = [
        counts.improvement && `${counts.improvement} improvement${counts.improvement === 1 ? "" : "s"}`,
        counts.fix && `${counts.fix} bug fix${counts.fix === 1 ? "" : "es"}`
    ].filter(Boolean);
    return parts.length > 0 ? `Also in this release: ${parts.join(" and ")}.` : undefined;
}

/** The paragraphs of a run of Markdown lines, leaving out `<details>` blocks. */
function paragraphs(lines: string[]): string[] {
    const result: string[] = [];
    let current: string[] = [];
    let inDetails = false;
    const flush = () => {
        if (current.length > 0) result.push(current.join(" ").trim());
        current = [];
    };
    for (const line of lines) {
        if (line.trim().startsWith("<details")) inDetails = true;
        if (inDetails) {
            if (line.includes("</details>")) inDetails = false;
            flush();
            continue;
        }
        if (line.trim() === "") flush();
        else current.push(line.trim());
    }
    flush();
    return result;
}

/**
 * Converts the inline Markdown of a release note to the markup AppStream allows: links and
 * HTML tags keep only their text, bold becomes plain, and emphasis and code spans map to
 * `<em>` and `<code>`.
 */
function inlineMarkdown(text: string): string {
    const plain = text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
    return plain
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>")
        .replace(/(^|[^\w*])\*([^*]+)\*(?=[^\w*]|$)/g, "$1<em>$2</em>")
        .replace(/\s+/g, " ")
        .trim();
}

function renderDescription(blocks: DescriptionBlock[], indent: string): string {
    if (blocks.length === 0) {
        return "";
    }
    const body = blocks.map((block) => ("paragraph" in block
        ? `${indent}  <p>${block.paragraph}</p>\n`
        : `${indent}  <ul>\n`
            + block.items.map((item) => `${indent}    <li>${item}</li>\n`).join("")
            + `${indent}  </ul>\n`)).join("");
    return `${indent}<description>\n${body}${indent}</description>\n`;
}

function readReleaseNotes(version: string): string {
    const file = join(RELEASE_NOTES_DIR, `v${version}.md`);
    if (!existsSync(file)) {
        throw new Error(`Found no release note for v${version} at ${file}; Flathub shows it as the `
            + "release's notes, so write it first (pnpm chore:release-notes).");
    }
    return readFileSync(file, "utf-8");
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
