import path from "path";
import fs from "fs";
import type NoteMeta from "./meta/note_meta.js";
import type { NoteMetaFile } from "./meta/note_meta.js";
import type BNote from "../becca/entities/bnote.js";
import becca from "../becca/becca.js";
import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { RESOURCE_DIR } from "./resource_dir.js";

export function getHelpHiddenSubtreeData() {
    const helpDir = path.join(RESOURCE_DIR, "doc_notes", "en", "User Guide");
    const metaFilePath = path.join(helpDir, "!!!meta.json");

    try {
        return JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));
    } catch (e) {
        console.warn(e);
        return [];
    }
}

export function parseNoteMetaFile(noteMetaFile: NoteMetaFile): HiddenSubtreeItem[] {
    if (!noteMetaFile.files) {
        console.log("No meta files");
        return [];
    }

    const metaRoot = noteMetaFile.files[0];
    const parsedMetaRoot = parseNoteMeta(metaRoot, "/" + (metaRoot.dirFileName ?? ""));
    return parsedMetaRoot?.children ?? [];
}

export function parseNoteMeta(noteMeta: NoteMeta, docNameRoot: string): HiddenSubtreeItem | null {
    let iconClass: string = "bx bx-file";
    const item: HiddenSubtreeItem = {
        id: `_help_${noteMeta.noteId}`,
        title: noteMeta.title ?? "",
        type: "doc", // can change
        attributes: []
    };

    // Handle folder notes
    if (!noteMeta.dataFileName) {
        iconClass = "bx bx-folder";
        item.type = "book";
    }

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
        item.attributes?.push({
            type: "label",
            name: "docName",
            value: docPath
        });
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
            let newDocNameRoot = noteMeta.dirFileName ? `${docNameRoot}/${noteMeta.dirFileName}` : docNameRoot;
            const item = parseNoteMeta(childMeta, newDocNameRoot);
            if (item) {
                children.push(item);
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
/**
 * Iterates recursively through the help subtree that the user has and compares it against the definition
 * to remove any notes that are no longer present in the latest version of the help.
 *
 * @param helpDefinition the hidden subtree definition for the help, to compare against the user's structure.
 */
export function cleanUpHelp(helpDefinition: HiddenSubtreeItem[]) {
    function getFlatIds(items: HiddenSubtreeItem | HiddenSubtreeItem[]) {
        const ids: (string | string[])[] = [];
        if (Array.isArray(items)) {
            for (const item of items) {
                ids.push(getFlatIds(item));
            }
        } else {
            if (items.children) {
                for (const child of items.children) {
                    ids.push(getFlatIds(child));
                }
            }
            ids.push(items.id);
        }
        return ids.flat();
    }

    function getFlatIdsFromNote(note: BNote | null) {
        if (!note) {
            return [];
        }

        const ids: (string | string[])[] = [];

        for (const subnote of note.getChildNotes()) {
            ids.push(getFlatIdsFromNote(subnote));
        }

        ids.push(note.noteId);
        return ids.flat();
    }

    const definitionHelpIds = new Set(getFlatIds(helpDefinition));
    const realHelpIds = getFlatIdsFromNote(becca.getNote("_help"));

    for (const realHelpId of realHelpIds) {
        if (realHelpId === "_help") {
            continue;
        }

        if (!definitionHelpIds.has(realHelpId)) {
            becca.getNote(realHelpId)?.deleteNote();
        }
    }
}
