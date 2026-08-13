import type { HelpBundle, HelpMetaItem } from "@triliumnext/commons";
import path from "path";

import type { HelpSources } from "./help_meta_generator.js";

/**
 * Builds the in-app help content bundle: the rendered page of every note in the help tree,
 * keyed by note ID.
 *
 * Pages are authored as markdown under `docs/User Guide` and the application displays HTML, so
 * the conversion happens here, once, rather than in each application at runtime — that keeps the
 * markdown renderer out of the server and standalone builds, and pins the whole User Guide to a
 * single renderer version that is reviewed along with the docs.
 *
 * Reading and rendering are injected so this stays a pure function: `edit-docs` passes the
 * filesystem and the same markdown conversion a user gets when importing a markdown file.
 *
 * @param meta the help tree, as produced by `buildHelpMeta`.
 * @param sources the export file behind each note, as produced alongside that tree.
 * @param readPage reads a note's source file (paths as they appear in {@link HelpSources}, i.e.
 *                 relative to the markdown export root), or returns null if it is missing.
 * @param renderMarkdown converts markdown to the HTML a text note holds.
 */
export function buildHelpBundle(
    meta: HelpMetaItem[],
    sources: HelpSources,
    readPage: (source: string) => string | null,
    renderMarkdown: (markdown: string, title: string) => string
): HelpBundle {
    const bundle: HelpBundle = {};
    collectPages(meta, sources, readPage, renderMarkdown, indexSources(sources), bundle);
    return bundle;
}

function collectPages(
    items: HelpMetaItem[],
    sources: HelpSources,
    readPage: (path: string) => string | null,
    renderMarkdown: (markdown: string, title: string) => string,
    noteIdBySource: Map<string, string>,
    bundle: HelpBundle
): void {
    for (const item of items) {
        const sourcePath = sources[item.id]?.source;

        if (sourcePath) {
            const source = readPage(sourcePath);

            if (source === null) {
                // One unreadable page must not cost the whole export; the note stays in the tree
                // and renders empty, which is visible in the application and in the diff.
                console.warn(`Help page '${sourcePath}' could not be read, skipping '${item.id}'.`);
            } else if (item.type === "code") {
                // Code notes are shown verbatim in their own language — running them through the
                // markdown renderer would turn a script into a paragraph.
                bundle[item.id] = source;
            } else {
                bundle[item.id] = rewriteLinks(renderMarkdown(source, item.title), sourcePath, noteIdBySource);
            }
        }

        if (item.children) {
            collectPages(item.children, sources, readPage, renderMarkdown, noteIdBySource, bundle);
        }
    }
}

/**
 * Maps every path a note can be addressed by to that note, for resolving links between pages: its
 * content file, and its directory — which is all a folder note has, since it holds no file itself.
 */
function indexSources(sources: HelpSources): Map<string, string> {
    const out = new Map<string, string>();

    for (const [ id, { source, dir } ] of Object.entries(sources)) {
        const noteId = id.replace(/^_help_/, "");

        if (source) {
            out.set(normalize(source), noteId);
        }
        if (dir) {
            out.set(normalize(dir), noteId);
        }
    }

    return out;
}

/**
 * Rewrites the two kinds of path a page is authored with.
 *
 * Links between pages become note links: pages are authored as files and link to each other by
 * relative path, but they are displayed as notes, where the only thing that resolves is the note's
 * ID. Anything that does not name another page — external URLs, in-page anchors (footnotes), the
 * deliberate `#root/…` deep links into system notes — is left exactly as authored.
 *
 * Everything else relative is an asset shipped alongside the guide (images, and the handful of
 * `.dat` files some pages link to). Those become {@link HELP_ASSET_TOKEN} paths from the export
 * root; each platform substitutes the token for wherever it serves them from, so one bundle works
 * everywhere.
 */
function rewriteLinks(html: string, source: string, noteIdBySource: Map<string, string>): string {
    const pageDir = path.posix.dirname(normalize(source));

    return html.replace(/(href|src)="([^"]*)"/g, (match, attribute: string, url: string) => {
        const noteId = resolveHelpTarget(url, pageDir, noteIdBySource);
        if (noteId) {
            return `${attribute}="#root/_help_${noteId}"`;
        }

        const asset = resolveHelpAsset(url, pageDir);
        return asset ? `${attribute}="${asset}"` : match;
    });
}

/**
 * Placeholder standing in for wherever a platform serves the guide's assets from — substituted
 * when a page is read (see `services/in_app_help.ts` in the core).
 */
export const HELP_ASSET_TOKEN = "{{helpAssets}}";

/** Resolves a page-relative asset reference to its path from the export root, or null. */
function resolveHelpAsset(url: string, pageDir: string): string | null {
    if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith(HELP_ASSET_TOKEN)) {
        return null;
    }

    // A markdown file is a page, not an asset. Having got this far it names one the guide does not
    // ship, so it is a broken link — left as authored rather than disguised as an asset URL.
    if (url.split("#")[0].endsWith(".md")) {
        return null;
    }

    const target = path.posix.normalize(path.posix.join(pageDir, toFilePath(url)));
    // Re-encoded per segment: the guide's file names carry spaces and ampersands, and pages write
    // them both ways — raw in `<img src>`, percent-encoded in markdown image syntax.
    return `${HELP_ASSET_TOKEN}/${target.split("/").map(encodeURIComponent).join("/")}`;
}

/** Resolves a page-relative href to the note it names, or null if it names something else. */
function resolveHelpTarget(href: string, pageDir: string, noteIdBySource: Map<string, string>): string | null {
    // In-page anchors and absolute URLs (including the `#root/…` deep links) address something
    // other than a file next to this page.
    if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return null;
    }

    // A note is addressed as a whole, so a fragment on the path has nothing to point at — the
    // HTML export dropped these too.
    const [ filePath ] = href.split("#");
    const target = path.posix.normalize(path.posix.join(pageDir, toFilePath(filePath)));

    // Folder notes are linked without their extension.
    return noteIdBySource.get(target) ?? noteIdBySource.get(`${target}.md`) ?? null;
}

/**
 * Turns a URL as written in a page into the file path it names, so it can be matched against the
 * export. Pages carry both forms — a raw `<img src>` keeps the file name as-is while markdown
 * syntax percent-encodes it — and the renderer escapes the ampersands of either as HTML.
 */
function toFilePath(url: string): string {
    const unescaped = url.replaceAll("&amp;", "&");

    try {
        return decodeURIComponent(unescaped);
    } catch {
        // A stray `%` in a file name is not an escape sequence; take the path as written.
        return unescaped;
    }
}

const normalize = (filePath: string) => path.posix.normalize(filePath.split(path.sep).join("/"));
