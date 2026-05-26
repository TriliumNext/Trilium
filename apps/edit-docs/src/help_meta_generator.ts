import type { HiddenSubtreeItem } from "@triliumnext/commons";
import path from "path";

import type NoteMeta from "@triliumnext/server/src/services/meta/note_meta.js";
import type { NoteMetaFile } from "@triliumnext/server/src/services/meta/note_meta.js";

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
    const parsedMetaRoot = parseNoteMeta(metaRoot, handleTextNote, "/" + (metaRoot.dirFileName ?? ""), baseUrl);
    return parsedMetaRoot?.children ?? [];
}

function parseNoteMeta(noteMeta: NoteMeta, handleTextNote: TextNoteHandler, docNameRoot: string, parentUrl?: string): HiddenSubtreeItem | null {
    let iconClass: string = "bx bx-file";
    const item: HiddenSubtreeItem = {
        id: `_help_${noteMeta.noteId}`,
        title: noteMeta.title ?? "",
        type: "doc",
        attributes: []
    };

    // Handle folder notes
    if (!noteMeta.dataFileName) {
        iconClass = "bx bx-folder";
        item.type = "book";
    }

    // Build the URL for this note
    const shareAlias = noteMeta.attributes?.find((a) => a.type === "label" && a.name === "shareAlias")?.value;
    const currentUrl = parentUrl && shareAlias ? `${parentUrl}/${shareAlias}` : parentUrl;
    const noteUrl = shareAlias ? currentUrl : undefined;

    // Handle attributes
    for (const attribute of noteMeta.attributes ?? []) {
        if (attribute.name === "iconClass") {
            iconClass = attribute.value;
            continue;
        }

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

    // Handle text notes
    if (noteMeta.type === "text" && noteMeta.dataFileName) {
        const docPath = `${docNameRoot}/${path.basename(noteMeta.dataFileName, ".html")}`.substring(1);
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
            const child = parseNoteMeta(childMeta, handleTextNote, newDocNameRoot, currentUrl);
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
