import type { HiddenSubtreeItem } from "@triliumnext/commons";
import type { NoteMeta, NoteMetaFile } from "@triliumnext/core";
import path from "path";

/**
 * Callback that defines how a text note is represented in the help meta.
 * @param item the HiddenSubtreeItem being built (mutate in place)
 * @param docPath the documentation path (e.g. "User Guide/Quick Start")
 * @param currentUrl the online URL for this note (if available)
 * @returns true to include the item, false to exclude it
 */
type TextNoteHandler = (item: HiddenSubtreeItem, docPath: string, currentUrl: string | undefined) => boolean;

/**
 * Server handler: text notes become `doc` type with `docName` and optional `docUrl` attributes.
 */
export const serverTextNoteHandler: TextNoteHandler = (item, docPath, currentUrl) => {
    item.attributes?.push({ type: "label", name: "docName", value: docPath });
    if (currentUrl) {
        item.attributes?.push({ type: "label", name: "docUrl", value: currentUrl });
    }
    return true;
};

/**
 * Standalone handler: text notes become `webView` type pointing to the online docs.
 * Excludes notes without an online URL.
 */
export const standaloneTextNoteHandler: TextNoteHandler = (item, _docPath, currentUrl) => {
    if (!currentUrl) {
        return false;
    }
    item.type = "webView";
    item.enforceAttributes = true;
    item.attributes?.push({ type: "label", name: "webViewSrc", value: currentUrl });
    return true;
};

/**
 * Parses a NoteMetaFile into HiddenSubtreeItem[] using the given text note handler.
 */
export function parseNoteMetaFile(noteMetaFile: NoteMetaFile, handleTextNote: TextNoteHandler, baseUrl?: string): HiddenSubtreeItem[] {
    if (!noteMetaFile.files) {
        console.warn("No meta files found to parse.");
        return [];
    }

    const metaRoot = noteMetaFile.files[0];
    const docNameRoot = "/" + (metaRoot.dirFileName ?? "");

    // A note cloned into several help locations appears once per location, but the runtime
    // hidden-subtree check enforces a single set of attributes per noteId. The per-occurrence
    // `iconClass`/`docName` would therefore conflict and flip-flop on every check. Index the
    // primary (non-clone) occurrence's values up front so every clone can reuse them.
    const canonicalByNoteId = new Map<string, CanonicalOccurrence>();
    indexPrimaryOccurrences(metaRoot, docNameRoot, canonicalByNoteId);

    const parsedMetaRoot = parseNoteMeta(metaRoot, handleTextNote, docNameRoot, canonicalByNoteId, baseUrl);
    return parsedMetaRoot?.children ?? [];
}

interface CanonicalOccurrence {
    iconClass: string;
    docPath?: string;
}

function parseNoteMeta(noteMeta: NoteMeta, handleTextNote: TextNoteHandler, docNameRoot: string, canonicalByNoteId: Map<string, CanonicalOccurrence>, parentUrl?: string): HiddenSubtreeItem | null {
    const item: HiddenSubtreeItem = {
        id: `_help_${noteMeta.noteId}`,
        title: noteMeta.title ?? "",
        type: "doc",
        attributes: []
    };

    // Handle folder notes
    if (!noteMeta.dataFileName) {
        item.type = "book";
    }

    // Build the URL for this note
    const shareAlias = noteMeta.attributes?.find((a) => a.type === "label" && a.name === "shareAlias")?.value;
    const currentUrl = parentUrl && shareAlias ? `${parentUrl}/${shareAlias}` : parentUrl;
    const noteUrl = shareAlias ? currentUrl : undefined;

    // Handle attributes
    for (const attribute of noteMeta.attributes ?? []) {
        if (attribute.name === "webViewSrc") {
            item.attributes?.push({
                type: "label",
                name: attribute.name,
                value: attribute.value
            });
        }

        if (attribute.name === "shareHiddenFromTree") {
            return null;
        }
    }

    // Clones share the underlying note, so resolve their per-occurrence icon/docName to the
    // primary occurrence's values; otherwise the two occurrences would enforce conflicting ones.
    const canonical = noteMeta.isClone ? canonicalByNoteId.get(noteMeta.noteId ?? "") : undefined;
    const iconClass = canonical?.iconClass ?? computeIconClass(noteMeta);

    // Handle text notes
    if (noteMeta.type === "text" && noteMeta.dataFileName) {
        const docPath = canonical?.docPath ?? computeDocPath(docNameRoot, noteMeta.dataFileName);
        if (!handleTextNote(item, docPath, noteUrl)) {
            return null;
        }
    }

    // Handle web views
    if (noteMeta.type === "webView") {
        item.type = "webView";
        item.enforceAttributes = true;
    }

    // Handle children
    if (noteMeta.children) {
        const children: HiddenSubtreeItem[] = [];
        for (const childMeta of noteMeta.children) {
            const newDocNameRoot = noteMeta.dirFileName ? `${docNameRoot}/${noteMeta.dirFileName}` : docNameRoot;
            const child = parseNoteMeta(childMeta, handleTextNote, newDocNameRoot, canonicalByNoteId, currentUrl);
            if (child) {
                children.push(child);
            }
        }
        item.children = children;
    }

    // Handle note icon
    item.attributes?.push({
        name: "iconClass",
        value: iconClass,
        type: "label"
    });

    return item;
}

/** Records the `iconClass`/`docName` of every primary (non-clone) occurrence so clones can reuse them. */
function indexPrimaryOccurrences(noteMeta: NoteMeta, docNameRoot: string, out: Map<string, CanonicalOccurrence>): void {
    if (!noteMeta.isClone && noteMeta.noteId) {
        out.set(noteMeta.noteId, {
            iconClass: computeIconClass(noteMeta),
            docPath: noteMeta.type === "text" && noteMeta.dataFileName ? computeDocPath(docNameRoot, noteMeta.dataFileName) : undefined
        });
    }

    if (noteMeta.children) {
        const childDocNameRoot = noteMeta.dirFileName ? `${docNameRoot}/${noteMeta.dirFileName}` : docNameRoot;
        for (const childMeta of noteMeta.children) {
            indexPrimaryOccurrences(childMeta, childDocNameRoot, out);
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

function computeDocPath(docNameRoot: string, dataFileName: string): string {
    return `${docNameRoot}/${path.basename(dataFileName, ".html")}`.substring(1);
}
