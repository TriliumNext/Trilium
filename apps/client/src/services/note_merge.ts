import { isMergeHistoryRole } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import dialog from "./dialog.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import server from "./server.js";
import { flushPendingNoteSaves } from "./spaced_update.js";
import toast from "./toast.js";

/**
 * Role of the attachment that remembers merges still waiting to be undone.
 * Hidden from the attachment list.
 */
export const MERGE_UNDO_ROLE = "mergeUndo";

export function isMergeUndoAttachment(attachment: { role: string }) {
    return isMergeHistoryRole(attachment.role);
}

/** Ordinary user notes. The root, system notes, search notes and launchers are left out. */
export function canMergeNote(note: { noteId: string; type: string }) {
    return note.noteId !== "root"
        && !note.noteId.startsWith("_")
        && note.type !== "search"
        && note.type !== "launcher";
}

/** A note as it stood in the tree when the merge started. */
export interface MergeTreeNode {
    branchId: string;
    noteId: string;
}

/** Which tree rows should be selected once the merge has removed the notes it consumed. */
export interface MergeSelectionPlan {
    /** Branches that were selected and still exist. */
    branchIds: string[];
    /** A selected note was merged away, and the note that remains was not already among the rows kept. */
    selectTarget: boolean;
    /** The note that stays open. A merged-away note is replaced by the one that remains. */
    activeNoteId: string;
}

/**
 * The note that was selected stays selected. A note that was merged away is replaced by the note
 * that remains, and when nothing was selected that note is selected on its own.
 */
export function planSelectionAfterMerge(
    selected: readonly MergeTreeNode[],
    active: MergeTreeNode | null,
    targetNoteId: string,
    sourceNoteIds: readonly string[]
): MergeSelectionPlan {
    const sources = new Set(sourceNoteIds);
    const starting = selected.length > 0 ? selected : (active ? [ active ] : []);
    const branchIds: string[] = [];
    let mergedAway = false;
    let targetKept = false;
    for (const node of starting) {
        if (!node.noteId || sources.has(node.noteId)) {
            if (node.noteId && sources.has(node.noteId)) {
                mergedAway = true;
            }
            continue;
        }
        if (node.noteId === targetNoteId) {
            targetKept = true;
        }
        if (node.branchId && !branchIds.includes(node.branchId)) {
            branchIds.push(node.branchId);
        }
    }

    const activeSurvives = !!active?.noteId && !sources.has(active.noteId);
    return {
        branchIds,
        selectTarget: (mergedAway && !targetKept) || branchIds.length === 0,
        activeNoteId: activeSurvives && active ? active.noteId : targetNoteId
    };
}

interface PendingMergeSelection {
    selected: MergeTreeNode[];
    active: MergeTreeNode | null;
    /** Notes the merge deletes. The new note is not among them. */
    consumedNoteIds: string[];
    /** Set once the request has returned the new note. */
    resultNoteId: string | null;
    /** The tree has already removed a consumed note, so the highlight can be corrected. */
    deletionsSeen: boolean;
}

let pendingMergeSelection: PendingMergeSelection | null = null;

export function armMergeSelection(pending: PendingMergeSelection) {
    pendingMergeSelection = pending;
}

export function peekMergeSelection() {
    return pendingMergeSelection;
}

export function takeMergeSelection() {
    const pending = pendingMergeSelection;
    pendingMergeSelection = null;
    return pending;
}

export function setMergeResult(noteId: string) {
    if (pendingMergeSelection) {
        pendingMergeSelection.resultNoteId = noteId;
    }
}

/** First occurrence of each id, in the order given. Two clones of one note count once. */
export function distinctNoteIds(noteIds: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const noteId of noteIds) {
        if (seen.has(noteId)) {
            continue;
        }
        seen.add(noteId);
        result.push(noteId);
    }
    return result;
}

/** Asks for one note and merges it into `targetNoteId`. */
export async function mergeNoteFrom(targetNoteId: string) {
    const target = await froca.getNote(targetNoteId);
    if (!target || !canMergeNote(target)) {
        return;
    }

    const sourceNoteId = await dialog.chooseNote({
        title: t("merge_notes.pick-title"),
        message: t("merge_notes.pick-message"),
        okLabel: t("merge_notes.pick-ok")
    });
    if (!sourceNoteId) {
        return;
    }
    if (sourceNoteId === targetNoteId) {
        toast.showError(t("merge_notes.same-note"));
        return;
    }

    const source = await froca.getNote(sourceNoteId);
    if (!source) {
        toast.showError(t("merge_notes.missing-note"));
        return;
    }

    await postMerge(target.noteId, [ source.noteId ], undefined, () => t("merge_notes.done-one", {
        first: target.title,
        second: source.title,
        title: target.title
    }));
}

/**
 * Replaces every note in `noteIds` with a new note.
 *
 * One id asks which note to merge with. Several ask for the title of the new note.
 * `noteIds` is the note tree's order: content is appended in that order, starting with the first.
 */
export async function mergeNotes(noteIds: string[]) {
    const ids = distinctNoteIds(noteIds);
    if (ids.length === 0) {
        return;
    }
    if (ids.length === 1) {
        const only = ids[0];
        if (only) {
            await mergeNoteFrom(only);
        }
        return;
    }

    const notes = await froca.getNotes(ids);
    if (notes.length !== ids.length) {
        toast.showError(t("merge_notes.missing-note"));
        return;
    }

    const target = notes[0];
    if (!target) {
        toast.showError(t("merge_notes.missing-note"));
        return;
    }

    const title = await dialog.prompt({
        title: t("merge_notes.title-title"),
        message: t("merge_notes.title-message"),
        defaultValue: target.title
    });
    if (title === null) {
        return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
        toast.showError(t("merge_notes.empty-title"));
        return;
    }

    await postMerge(target.noteId, ids.slice(1), trimmed, () => t("merge_notes.done-many", {
        count: ids.length,
        title: trimmed
    }));
}

async function postMerge(
    targetNoteId: string,
    sourceNoteIds: string[],
    title: string | undefined,
    done: () => string
) {
    const tree = appContext.noteTreeWidget;
    const activeNode = tree?.getActiveNode();
    const contextNoteId = appContext.tabManager.getActiveContext()?.note?.noteId;
    const active = nodeOf(activeNode?.data.noteId, activeNode?.data.branchId)
        ?? (contextNoteId ? { branchId: "", noteId: contextNoteId } : null);
    const selected = (tree?.getSelectedNodes() ?? [])
        .map((node) => nodeOf(node.data.noteId, node.data.branchId))
        .filter((node): node is MergeTreeNode => node !== null);
    armMergeSelection({
        selected,
        active,
        consumedNoteIds: [ targetNoteId, ...sourceNoteIds ],
        resultNoteId: null,
        deletionsSeen: false
    });

    let mergedNoteId: string;
    try {
        // The originals are deleted by the request. A save still in flight would then be dropped,
        // so the editor's latest text has to land first.
        await flushPendingNoteSaves([ targetNoteId, ...sourceNoteIds ]);
        const result = await server.post<{ noteId: string }>(
            `notes/${targetNoteId}/merge`, { sourceNoteIds, title }
        );
        mergedNoteId = result.noteId;
    } catch {
        takeMergeSelection();
        // The request already toasted the server's reason.
        return;
    }
    setMergeResult(mergedNoteId);
    toast.showMessage(done());

    // The desktop tree applies the selection once it has removed the deleted notes. A layout
    // without that tree, such as the phone, switches the open note here.
    if (!tree) {
        takeMergeSelection();
        const noteContext = appContext.tabManager.getActiveContext();
        if (noteContext && noteContext.note?.noteId !== mergedNoteId) {
            await noteContext.setNote(mergedNoteId);
        }
        return;
    }
    await tree.applyPendingMergeSelection();
}

/** Puts one merged note back. Without `entryId`, the most recently merged note is restored. */
export async function undoMerge(mergedNoteId: string, entryId?: string) {
    try {
        await server.post(
            `notes/${mergedNoteId}/merge-undo`,
            entryId ? { entryId } : {}
        );
    } catch {
        // The request already toasted the server's reason.
        return;
    }
    toast.showMessage(t("merge_notes.undone"));
}

function nodeOf(noteId: unknown, branchId: unknown): MergeTreeNode | null {
    if (typeof noteId !== "string" || !noteId) {
        return null;
    }
    return { noteId, branchId: typeof branchId === "string" ? branchId : "" };
}
