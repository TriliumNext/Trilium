// Loading import.ts registers the shared "importNotes" WebSocket toast handlers (progress + success).
// The OneNote import reuses that taskType, but the OneNote dialog never loads import.ts on its own, so
// without this side-effect import the progress/finished toasts would never appear.
import "./import.js";

import type { OneNoteDeviceLogin, OneNoteDevicePollResult, OneNoteFolderRef, OneNoteNotebook, OneNoteSection, OneNoteSectionGroup, OneNoteSectionSelection } from "@triliumnext/commons";

import server from "./server.js";

// The notebook/section/selection types are shared with the server; re-export them so existing callers
// (the import dialog, tests) keep importing them from this service.
export type { OneNoteDeviceLogin, OneNoteDevicePollResult, OneNoteFolderRef, OneNoteNotebook, OneNoteSection, OneNoteSectionGroup, OneNoteSectionSelection };

export interface OneNoteAccount {
    name: string;
    email: string;
}

export interface OneNoteStatus {
    connected: boolean;
    account: OneNoteAccount | null;
}

// Starts a device-flow sign-in (RFC 8628): the server obtains a short user code from Microsoft, the
// dialog shows it, and the user enters it at the verification URI in any browser. There is no OAuth
// redirect back to the server, so this works no matter what domain the server is reachable on.
function deviceLogin() {
    return server.post<OneNoteDeviceLogin>("onenote-import/device-login");
}

// One round of asking the server whether the pending device sign-in has completed; called on the
// interval returned by deviceLogin until the result is `connected` or `failed`.
function devicePoll() {
    return server.post<OneNoteDevicePollResult>("onenote-import/device-poll");
}

function getStatus() {
    return server.get<OneNoteStatus>("onenote-import/status");
}

function disconnect() {
    return server.post("onenote-import/disconnect");
}

function getNotebooks() {
    return server.get<{ notebooks: OneNoteNotebook[] }>("onenote-import/notebooks");
}

// Kicks off the import and returns as soon as the server has accepted it. The import itself runs in the
// background on the server; progress, completion (navigation to the imported note) and any error all
// arrive over the WebSocket via the shared "importNotes" toast handlers in import.ts.
function runImport(payload: { parentNoteId: string; sections: OneNoteSectionSelection[]; taskId: string; debug?: boolean; shrinkImages?: boolean }) {
    return server.post<void>("onenote-import/import", payload);
}

export default {
    deviceLogin,
    devicePoll,
    getStatus,
    disconnect,
    getNotebooks,
    runImport
};

export type OneNoteContainer = OneNoteNotebook | OneNoteSectionGroup;

/** A container's direct child in the OneNote left rail — either a section or a (nested) section group. */
export type OneNoteChild = { type: "section"; section: OneNoteSection } | { type: "group"; group: OneNoteSectionGroup };

/**
 * Flattens the selected sections out of the notebook tree, tagging each with its notebook and the
 * section-group path (notebook root → the section's immediate group) the server needs to recreate the
 * folder nesting. Children are visited in OneNote rail order (see orderedChildren), so the resulting
 * note tree is created in that order; section groups contribute structure only and are never selectable.
 */
export function buildSectionSelections(notebooks: OneNoteNotebook[], selectedIds: Set<string>): OneNoteSectionSelection[] {
    const selections: OneNoteSectionSelection[] = [];

    const visit = (container: OneNoteContainer, notebook: OneNoteNotebook, groupPath: OneNoteFolderRef[]) => {
        for (const child of orderedChildren(container)) {
            if (child.type === "group") {
                const { group } = child;
                visit(group, notebook, [...groupPath, { id: group.id, title: group.title, createdDateTime: group.createdDateTime, lastModifiedDateTime: group.lastModifiedDateTime }]);
            } else if (selectedIds.has(child.section.id)) {
                const { section } = child;
                selections.push({
                    id: section.id,
                    title: section.title,
                    createdDateTime: section.createdDateTime,
                    lastModifiedDateTime: section.lastModifiedDateTime,
                    groupPath,
                    notebookId: notebook.id,
                    notebookTitle: notebook.title,
                    notebookCreatedDateTime: notebook.createdDateTime,
                    notebookLastModifiedDateTime: notebook.lastModifiedDateTime
                });
            }
        }
    };

    for (const notebook of notebooks) {
        visit(notebook, notebook, []);
    }

    return selections;
}

/**
 * Returns a container's direct children — its sections and section groups — interleaved into a single
 * list ordered by creation date. OneNote shows sections and groups intermixed in one ordered rail but
 * the Graph API exposes no ordering field for them, so creation date is a best-effort approximation
 * (see the order caveat shown in the picker). Pages keep their exact order (they do carry one).
 */
export function orderedChildren(container: OneNoteContainer): OneNoteChild[] {
    const children: OneNoteChild[] = [
        ...container.sections.map((section): OneNoteChild => ({ type: "section", section })),
        ...container.sectionGroups.map((group): OneNoteChild => ({ type: "group", group }))
    ];
    // ISO-8601 timestamps sort lexicographically = chronologically; the sort is stable, so children
    // sharing a timestamp keep the API's alphabetical order as a tiebreak.
    return children.sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
}

function orderKey(child: OneNoteChild): string {
    return (child.type === "section" ? child.section.createdDateTime : child.group.createdDateTime) ?? "";
}
