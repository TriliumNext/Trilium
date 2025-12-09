"use strict";

import sql from "./sql.js";
import log from "./log.js";
import BBranch from "../becca/entities/bbranch.js";
import entityChangesService from "./entity_changes.js";
import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";

export interface ValidationResponse {
    branch: BBranch | null;
    success: boolean;
    message?: string;
}

function validateParentChild(parentNoteId: string, childNoteId: string, branchId: string | null = null): ValidationResponse {
    if (["root", "_hidden", "_share", "_lbRoot", "_lbAvailableLaunchers", "_lbVisibleLaunchers"].includes(childNoteId)) {
        return { branch: null, success: false, message: `Cannot change this note's location.` };
    }

    if (parentNoteId === "none") {
        // this shouldn't happen
        return { branch: null, success: false, message: `Cannot move anything into 'none' parent.` };
    }

    const existingBranch = becca.getBranchFromChildAndParent(childNoteId, parentNoteId);

    if (existingBranch && existingBranch.branchId !== branchId) {
        const parentNote = becca.getNote(parentNoteId);
        const childNote = becca.getNote(childNoteId);

        return {
            branch: existingBranch,
            success: false,
            message: `Note "${childNote?.title}" note already exists in the "${parentNote?.title}".`
        };
    }

    if (wouldAddingBranchCreateCycle(parentNoteId, childNoteId)) {
        return {
            branch: null,
            success: false,
            message: "Moving/cloning note here would create cycle."
        };
    }

    if (parentNoteId !== "_lbBookmarks" && becca.getNote(parentNoteId)?.type === "launcher") {
        return {
            branch: null,
            success: false,
            message: "Launcher note cannot have any children."
        };
    }

    return { branch: null, success: true };
}

/**
 * Tree cycle can be created when cloning or when moving existing clone. This method should detect both cases.
 */
function wouldAddingBranchCreateCycle(parentNoteId: string, childNoteId: string) {
    if (parentNoteId === childNoteId) {
        return true;
    }

    const childNote = becca.getNote(childNoteId);
    const parentNote = becca.getNote(parentNoteId);

    if (!childNote || !parentNote) {
        return false;
    }

    // we'll load the whole subtree - because the cycle can start in one of the notes in the subtree
    const childSubtreeNoteIds = new Set(childNote.getSubtreeNoteIds());
    const parentAncestorNoteIds = parentNote.getAncestorNoteIds();

    return parentAncestorNoteIds.some((parentAncestorNoteId) => childSubtreeNoteIds.has(parentAncestorNoteId));
}

function sortNotes(parentNoteId: string, customSortBy: string = "title", reverse = false, foldersFirst = false, sortNatural = false, _sortLocale?: string | null) {
    if (!customSortBy) {
        customSortBy = "title";
    }

    // sortLocale can not be empty string or null value, default value must be set to undefined.
    const sortLocale = _sortLocale || undefined;

    sql.transactional(() => {
        const note = becca.getNote(parentNoteId);
        if (!note) {
            throw new Error("Unable to find note");
        }

        const notes = note.getChildNotes();

        function normalize<T>(obj: T | string) {
            return obj && typeof obj === "string" ? obj.toLowerCase() : obj;
        }

        notes.sort((a, b) => {
            if (foldersFirst) {
                const aHasChildren = a.hasChildren();
                const bHasChildren = b.hasChildren();

                if ((aHasChildren && !bHasChildren) || (!aHasChildren && bHasChildren)) {
                    // exactly one note of the two is a directory, so the sorting will be done based on this status
                    return aHasChildren ? -1 : 1;
                }
            }

            function fetchValue(note: BNote, key: string) {
                let rawValue: string | null;

                if (key === "title") {
                    const branch = note.getParentBranches().find((branch) => branch.parentNoteId === parentNoteId);
                    const prefix = branch?.prefix;
                    rawValue = prefix ? `${prefix} - ${note.title}` : note.title;
                } else {
                    rawValue = ["dateCreated", "dateModified"].includes(key) ? (note as any)[key] : note.getLabelValue(key);
                }

                return normalize(rawValue);
            }

            function compare(a: string, b: string) {
                if (!sortNatural) {
                    // alphabetical sort
                    return b === null || b === undefined || a < b ? -1 : 1;
                } else {
                    // natural sort
                    return a.localeCompare(b, sortLocale, { numeric: true, sensitivity: "base" });
                }
            }

            const topAEl = fetchValue(a, "top");
            const topBEl = fetchValue(b, "top");

            if (topAEl !== topBEl) {
                if (topAEl === null) return reverse ? -1 : 1;
                if (topBEl === null) return reverse ? 1 : -1;

                // since "top" should not be reversible, we'll reverse it once more to nullify this effect
                return compare(topAEl, topBEl) * (reverse ? -1 : 1);
            }

            const bottomAEl = fetchValue(a, "bottom");
            const bottomBEl = fetchValue(b, "bottom");

            if (bottomAEl !== bottomBEl) {
                if (bottomAEl === null) return reverse ? 1 : -1;
                if (bottomBEl === null) return reverse ? -1 : 1;

                // since "bottom" should not be reversible, we'll reverse it once more to nullify this effect
                return compare(bottomBEl, bottomAEl) * (reverse ? -1 : 1);
            }

            const customAEl = fetchValue(a, customSortBy) ?? fetchValue(a, "title") as string;
            const customBEl = fetchValue(b, customSortBy) ?? fetchValue(b, "title")  as string;

            if (customAEl !== customBEl) {
                return compare(customAEl, customBEl);
            }

            const titleAEl = fetchValue(a, "title") as string;
            const titleBEl = fetchValue(b, "title") as string;

            return compare(titleAEl, titleBEl);
        });

        if (reverse) {
            notes.reverse();
        }

        let position = 10;
        let someBranchUpdated = false;

        for (const note of notes) {
            const branch = note.getParentBranches().find((b) => b.parentNoteId === parentNoteId);
            if (!branch) {
                continue;
            }

            if (branch.noteId === "_hidden") {
                position = 999_999_999;
            }

            if (branch.notePosition !== position) {
                sql.execute("UPDATE branches SET notePosition = ? WHERE branchId = ?", [position, branch.branchId]);

                branch.notePosition = position;
                someBranchUpdated = true;
            }

            position += 10;
        }

        if (someBranchUpdated) {
            entityChangesService.putNoteReorderingEntityChange(parentNoteId);
        }
    });
}

function sortNotesIfNeeded(parentNoteId: string) {
    const parentNote = becca.getNote(parentNoteId);
    if (!parentNote) {
        return;
    }

    const sortedLabel = parentNote.getLabel("sorted");

    if (!sortedLabel || sortedLabel.value === "off") {
        return;
    }

    const sortReversed = parentNote.getLabelValue("sortDirection")?.toLowerCase() === "desc";
    const sortFoldersFirst = parentNote.isLabelTruthy("sortFoldersFirst");
    const sortNatural = parentNote.isLabelTruthy("sortNatural");
    const sortLocale = parentNote.getLabelValue("sortLocale");

    sortNotes(parentNoteId, sortedLabel.value, sortReversed, sortFoldersFirst, sortNatural, sortLocale);
}

/**
 * @deprecated this will be removed in the future
 */
function setNoteToParent(noteId: string, prefix: string, parentNoteId: string) {
    const parentNote = becca.getNote(parentNoteId);

    if (parentNoteId && !parentNote) {
        // null parentNoteId is a valid value
        throw new Error(`Cannot move note to deleted / missing parent note '${parentNoteId}'`);
    }

    // case where there might be more such branches is ignored. It's expected there should be just one
    const branchId = sql.getValue<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND noteId = ? AND prefix = ?", [noteId, prefix]);
    const branch = becca.getBranch(branchId);

    if (branch) {
        if (!parentNoteId) {
            log.info(`Removing note '${noteId}' from parent '${parentNoteId}'`);

            branch.markAsDeleted();
        } else {
            const newBranch = branch.createClone(parentNoteId);
            newBranch.save();

            branch.markAsDeleted();
        }
    } else if (parentNoteId) {
        const note = becca.getNote(noteId);
        if (!note) {
            throw new Error(`Cannot find note '${noteId}.`);
        }

        if (note.isDeleted) {
            throw new Error(`Cannot create a branch for '${noteId}' which is deleted.`);
        }

        const branchId = sql.getValue<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND noteId = ? AND parentNoteId = ?", [noteId, parentNoteId]);
        const branch = becca.getBranch(branchId);

        if (branch) {
            branch.prefix = prefix;
            branch.save();
        } else {
            new BBranch({
                noteId: noteId,
                parentNoteId: parentNoteId,
                prefix: prefix
            }).save();
        }
    }
}

export default {
    validateParentChild,
    sortNotes,
    sortNotesIfNeeded,
    setNoteToParent
};
