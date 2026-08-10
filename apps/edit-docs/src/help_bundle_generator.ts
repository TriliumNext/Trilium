import type { HelpBundle, HelpMetaItem } from "@triliumnext/commons";

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
    collectPages(meta, readPage, renderMarkdown, bundle);
    return bundle;
}

function collectPages(
    items: HelpMetaItem[],
    readPage: (source: string) => string | null,
    renderMarkdown: (markdown: string, title: string) => string,
    bundle: HelpBundle
): void {
    for (const item of items) {
        if (item.source) {
            const source = readPage(item.source);

            if (source === null) {
                // One unreadable page must not cost the whole export; the note stays in the tree
                // and renders empty, which is visible in the application and in the diff.
                console.warn(`Help page '${item.source}' could not be read, skipping '${item.id}'.`);
            } else {
                // Code notes are shown verbatim in their own language — running them through the
                // markdown renderer would turn a script into a paragraph.
                bundle[item.id] = item.type === "code" ? source : renderMarkdown(source, item.title);
            }
        }

        if (item.children) {
            collectPages(item.children, readPage, renderMarkdown, bundle);
        }
    }
}
