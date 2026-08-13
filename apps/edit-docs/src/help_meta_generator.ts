import type { HelpMetaItem, HiddenSubtreeAttribute } from "@triliumnext/commons";
import type { NoteMeta, NoteMetaFile } from "@triliumnext/core";

/**
 * Builds the in-app help tree from the User Guide's markdown export meta.
 *
 * The tree describes the `_help` subtree the application injects into becca; the files backing it
 * come back beside it rather than within it, since which markdown produced a page is of no use to
 * anything past the build. Rendering that markdown into the page content the app displays is the
 * build's job too, not this module's — here we only resolve structure, identity and the labels
 * the notes carry.
 *
 * @param noteMetaFile the `!!!meta.json` written next to the markdown export.
 * @param baseUrl root of the online documentation, used to resolve the canonical page URLs
 *                (`docUrl`) and to absolutise root-relative web view sources.
 */
export function buildHelpMeta(noteMetaFile: NoteMetaFile, baseUrl?: string): HelpMetaResult {
    if (!noteMetaFile.files) {
        console.warn("No meta files found to parse.");
        return { meta: [], sources: {} };
    }

    const metaRoot = noteMetaFile.files[0];

    // A note cloned into several help locations appears once per location, but only one of the
    // occurrences is the real thing: the others carry no attributes and a ".clone" data file.
    // Index the primary occurrence's values up front so every clone can reuse them.
    const canonicalByNoteId = new Map<string, CanonicalOccurrence>();
    indexPrimaryOccurrences(metaRoot, "", canonicalByNoteId);

    // Sources are relative to the export directory, which is the root note's own directory, so
    // the walk starts empty and picks up that directory on its first step down. The documentation
    // root doubles as the parent URL every page's share alias is appended to.
    const sources: HelpSources = {};
    const parsedMetaRoot = parseNoteMeta(metaRoot, "", canonicalByNoteId, sources, baseUrl, baseUrl);
    return { meta: parsedMetaRoot?.children ?? [], sources };
}

/** The help tree, and the export files each of its notes was built from. */
export interface HelpMetaResult {
    meta: HelpMetaItem[];
    sources: HelpSources;
}

/**
 * Where each note's content came from, by note ID. Only the build has any use for it: the bundler
 * reads the pages through it and resolves the links between them, and then it is thrown away
 * rather than shipped.
 */
export type HelpSources = Record<string, HelpPageSource>;

export interface HelpPageSource {
    /**
     * Content file, relative to the markdown export root (e.g. `User Guide/Note Types/Text.md`).
     * Absent for folders and web views, which have no file of their own. Clones point at the
     * primary occurrence's file rather than their own `.clone` copy.
     */
    source?: string;
    /**
     * Directory this note's children live in, relative to the markdown export root. Set for every
     * note that has one, and the only way to address a folder note: it has no file of its own, so
     * pages link to it by its directory.
     */
    dir?: string;
}

interface CanonicalOccurrence {
    iconClass: string;
    source?: string;
}

function parseNoteMeta(
    noteMeta: NoteMeta,
    sourceRoot: string,
    canonicalByNoteId: Map<string, CanonicalOccurrence>,
    sources: HelpSources,
    baseUrl?: string,
    parentUrl?: string
): HelpMetaItem | null {
    const attributes: HiddenSubtreeAttribute[] = [];

    // Build the online URL for this note; only notes with a share alias of their own are
    // published, the rest just pass their parent's URL down to their children.
    const shareAlias = noteMeta.attributes?.find((a) => a.type === "label" && a.name === "shareAlias")?.value;
    const currentUrl = parentUrl && shareAlias ? `${parentUrl}/${shareAlias}` : parentUrl;

    for (const attribute of noteMeta.attributes ?? []) {
        if (attribute.name === "shareHiddenFromTree") {
            return null;
        }

        if (attribute.name === "webViewSrc") {
            attributes.push({
                type: "label",
                name: "webViewSrc",
                // Web views pointing inside the documentation are stored root-relative.
                value: absolutiseUrl(attribute.value, baseUrl)
            });
        }
    }

    if (shareAlias && currentUrl) {
        attributes.push({ type: "label", name: "docUrl", value: currentUrl });
    }

    // Clones share the underlying note, so resolve their icon and content file to the primary
    // occurrence's; otherwise the two occurrences would describe the same note differently.
    const canonical = noteMeta.isClone ? canonicalByNoteId.get(noteMeta.noteId ?? "") : undefined;
    attributes.push({
        type: "label",
        name: "iconClass",
        value: canonical?.iconClass ?? computeIconClass(noteMeta)
    });

    const item: HelpMetaItem = {
        id: `_help_${noteMeta.noteId}`,
        title: noteMeta.title ?? "",
        type: resolveType(noteMeta),
        attributes
    };

    if (item.type === "code") {
        item.mime = noteMeta.mime;
    }

    const source = item.type === "text" || item.type === "code"
        ? canonical?.source ?? computeSource(sourceRoot, noteMeta.dataFileName)
        : undefined;
    const dir = noteMeta.dirFileName ? computeSource(sourceRoot, noteMeta.dirFileName) : undefined;

    if (source || dir) {
        sources[item.id] = { source, dir };
    }

    if (noteMeta.children) {
        const childSourceRoot = noteMeta.dirFileName ? `${sourceRoot}/${noteMeta.dirFileName}` : sourceRoot;
        const children: HelpMetaItem[] = [];

        for (const childMeta of noteMeta.children) {
            const child = parseNoteMeta(childMeta, childSourceRoot, canonicalByNoteId, sources, baseUrl, currentUrl);
            if (child) {
                children.push(child);
            }
        }

        item.children = children;
    }

    return item;
}

/**
 * A note with no data file of its own is a pure folder. Web views render a remote page, so their
 * data file (if any) is irrelevant. Everything else carries content built from its source file.
 */
function resolveType(noteMeta: NoteMeta): HelpMetaItem["type"] {
    if (noteMeta.type === "webView") {
        return "webView";
    }
    if (!noteMeta.dataFileName) {
        return "book";
    }
    return noteMeta.type === "code" ? "code" : "text";
}

/** Records the icon and content file of every primary (non-clone) occurrence, for its clones. */
function indexPrimaryOccurrences(noteMeta: NoteMeta, sourceRoot: string, out: Map<string, CanonicalOccurrence>): void {
    if (!noteMeta.isClone && noteMeta.noteId) {
        out.set(noteMeta.noteId, {
            iconClass: computeIconClass(noteMeta),
            source: computeSource(sourceRoot, noteMeta.dataFileName)
        });
    }

    if (noteMeta.children) {
        const childSourceRoot = noteMeta.dirFileName ? `${sourceRoot}/${noteMeta.dirFileName}` : sourceRoot;
        for (const childMeta of noteMeta.children) {
            indexPrimaryOccurrences(childMeta, childSourceRoot, out);
        }
    }
}

function computeIconClass(noteMeta: NoteMeta): string {
    // An explicit iconClass wins; otherwise folders default to bx-folder and files to bx-file.
    const explicit = noteMeta.attributes?.find((a) => a.name === "iconClass")?.value;
    if (explicit) {
        return explicit;
    }
    return noteMeta.dataFileName ? "bx bx-file" : "bx bx-folder";
}

function computeSource(sourceRoot: string, dataFileName?: string): string | undefined {
    if (!dataFileName) {
        return undefined;
    }
    // The walk seeds the root as an empty string, so every path picked up along the way carries a
    // leading separator that has to come back off.
    return `${sourceRoot}/${dataFileName}`.substring(1);
}

function absolutiseUrl(url: string | undefined, baseUrl?: string): string | undefined {
    if (url?.startsWith("/") && baseUrl) {
        return `${baseUrl}${url}`;
    }
    return url;
}
