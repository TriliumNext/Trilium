import type { HiddenSubtreeItem } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";

export abstract class InAppHelpProvider {
    abstract getHelpHiddenSubtreeData(): HiddenSubtreeItem[];

    /**
     * Iterates recursively through the help subtree that the user has and compares it against the definition
     * to remove any notes that are no longer present in the latest version of the help.
     */
    cleanUpHelp(helpDefinition: HiddenSubtreeItem[]): void {
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
}

let provider: InAppHelpProvider | null = null;

export function initInAppHelp(p: InAppHelpProvider) {
    provider = p;
}

export function getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
    return provider?.getHelpHiddenSubtreeData() ?? [];
}

export function cleanUpHelp(items: HiddenSubtreeItem[]): void {
    provider?.cleanUpHelp(items);
}
