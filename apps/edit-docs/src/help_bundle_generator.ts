import type { HelpBundle, HelpMetaItem } from "@triliumnext/commons";
import path from "path";

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
 * @param readPage reads a note's source file (paths as they appear in {@link HelpMetaItem.source},
 *                 i.e. relative to the markdown export root), or returns null if it is missing.
 * @param renderMarkdown converts markdown to the HTML a text note holds.
 */
export function buildHelpBundle(
    meta: HelpMetaItem[],
    readPage: (source: string) => string | null,
    renderMarkdown: (markdown: string, title: string) => string
): HelpBundle {
    const bundle: HelpBundle = {};
    collectPages(meta, readPage, renderMarkdown, indexSources(meta), bundle);
    return bundle;
}

function collectPages(
    items: HelpMetaItem[],
    readPage: (source: string) => string | null,
    renderMarkdown: (markdown: string, title: string) => string,
    noteIdBySource: Map<string, string>,
    bundle: HelpBundle
): void {
    for (const item of items) {
        if (item.source) {
            const source = readPage(item.source);

            if (source === null) {
                // One unreadable page must not cost the whole export; the note stays in the tree
                // and renders empty, which is visible in the application and in the diff.
                console.warn(`Help page '${item.source}' could not be read, skipping '${item.id}'.`);
            } else if (item.type === "code") {
                // Code notes are shown verbatim in their own language — running them through the
                // markdown renderer would turn a script into a paragraph.
                bundle[item.id] = source;
            } else {
                bundle[item.id] = rewriteLinks(renderMarkdown(source, item.title), item.source, noteIdBySource);
            }
        }

        if (item.children) {
            collectPages(item.children, readPage, renderMarkdown, noteIdBySource, bundle);
        }
    }
}

/**
 * Maps every path a note can be addressed by to that note, for resolving links between pages: its
 * content file, and its directory — which is all a folder note has, since it holds no file itself.
 */
function indexSources(items: HelpMetaItem[], out = new Map<string, string>()): Map<string, string> {
    for (const item of items) {
        const noteId = item.id.replace(/^_help_/, "");

        if (item.source) {
            out.set(normalize(item.source), noteId);
        }
        if (item.dir) {
            out.set(normalize(item.dir), noteId);
        }
        if (item.children) {
            indexSources(item.children, out);
        }
    }
    return out;
}

/**
 * Turns the links between pages into note links. Pages are authored as files and link to each
 * other by relative path, but they are displayed as notes, where the only thing that resolves is
 * the note's ID.
 *
 * Anything that does not name another page of the guide is left exactly as authored: external
 * URLs, in-page anchors (footnotes), the deliberate `#root/…` deep links into system notes, and
 * the attachments a few pages point at.
 */
function rewriteLinks(html: string, source: string, noteIdBySource: Map<string, string>): string {
    const pageDir = path.posix.dirname(normalize(source));

    return html.replace(/href="([^"]*)"/g, (match, href: string) => {
        const noteId = resolveHelpTarget(href, pageDir, noteIdBySource);
        return noteId ? `href="#root/_help_${noteId}"` : match;
    });
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
    const target = path.posix.normalize(path.posix.join(pageDir, decodePath(filePath)));

    // Folder notes are linked without their extension.
    return noteIdBySource.get(target) ?? noteIdBySource.get(`${target}.md`) ?? null;
}

function decodePath(filePath: string): string {
    try {
        return decodeURIComponent(filePath);
    } catch {
        // A stray `%` in a filename is not an escape sequence; take the path as written.
        return filePath;
    }
}

const normalize = (filePath: string) => path.posix.normalize(filePath.split(path.sep).join("/"));
