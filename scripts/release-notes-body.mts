/**
 * Composes the GitHub release body from a release note, by rewriting its relative image
 * references into absolute URLs pinned to the tag being released.
 *
 * The notes under `docs/Release Notes` are exported from Trilium, so their images are bare
 * filenames sitting next to the Markdown:
 *
 *   <figure class="image"><img src="v0.105.0_image.png" width="1509" height="1329"></figure>
 *
 * That renders when browsing the repository, but a release body is not a file in the
 * repository — GitHub resolves a relative source against the releases URL, so every image
 * would arrive broken. The publish step in `release.yml` therefore runs the note through
 * this script and hands the result to `body_path` instead of the note itself.
 *
 * Pinning to `refs/tags/<tag>` rather than a branch keeps an already-published body correct
 * when the images are later renamed or moved.
 *
 * The script deliberately has no dependencies, so the publish job can run it straight off a
 * sparse checkout without installing the monorepo. Usage:
 *
 *   node --experimental-strip-types ./scripts/release-notes-body.mts v0.105.0 /tmp/body.md
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const NOTES_PATH = [ "docs", "Release Notes", "Release Notes" ];
const DEFAULT_REPOSITORY = "TriliumNext/Trilium";

export function main(tag: string, outputPath: string, repository: string) {
    const notePath = join(ROOT, ...NOTES_PATH, `${tag}.md`);
    if (!existsSync(notePath)) {
        throw new Error(`There is no release note for ${tag}; expected it at ${notePath}.`);
    }

    const { body, images } = rewriteImageSources(readFileSync(notePath, "utf-8"), { repository, tag });

    const missing = images.filter((image) => !existsSync(join(ROOT, ...image.split("/"))));
    if (missing.length > 0) {
        throw new Error(`${tag}.md references images that are not in the repository:\n  ${missing.join("\n  ")}`);
    }

    writeFileSync(outputPath, body);
    console.log(`Wrote ${outputPath} from ${notePath}.`);
    for (const image of images) {
        console.log(`  pinned ${image}`);
    }
}

interface RewriteOptions {
    repository: string;
    tag: string;
}

const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;
const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()([^)\s]+)/g;

/**
 * Returns the note with every relative image source replaced by a tag-pinned URL, alongside
 * the repository-relative path of each image it rewrote, so the caller can check they exist.
 */
export function rewriteImageSources(note: string, { repository, tag }: RewriteOptions) {
    const images: string[] = [];

    function pin(source: string) {
        if (!isRelative(source)) {
            return source;
        }

        const image = resolveAgainstNotes(source);
        images.push(image);
        const path = image.split("/").map(encodeURIComponent).join("/");
        return `https://raw.githubusercontent.com/${repository}/refs/tags/${encodeURIComponent(tag)}/${path}`;
    }

    const body = note
        .replace(HTML_IMAGE, (_match, prefix: string, quote: string, source: string) => `${prefix}${quote}${pin(source)}${quote}`)
        .replace(MARKDOWN_IMAGE, (_match, prefix: string, source: string) => `${prefix}${pin(source)}`);

    return { body, images };
}

function isRelative(source: string) {
    return !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith("//") && !source.startsWith("#");
}

function resolveAgainstNotes(source: string) {
    const segments = [ ...NOTES_PATH ];
    for (const segment of source.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }

        if (segment === "..") {
            segments.pop();
        } else {
            segments.push(segment);
        }
    }
    return segments.join("/");
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    const [ tag, outputPath ] = process.argv.slice(2);
    if (!tag || !outputPath) {
        console.error("Usage: release-notes-body.mts <tag> <output-path>");
        process.exit(1);
    }

    try {
        main(tag, outputPath, process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY);
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
