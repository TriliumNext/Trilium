"use strict";

import { getLog } from "./log.js";
import BBranch from "../becca/entities/bbranch.js";
import entityChangesService from "./entity_changes.js";
import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getSql } from "./sql/index.js";

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

export interface SortCriterion {
    /** `title`, `dateCreated`, `dateModified` or the name of a label on the child notes. */
    key: string;
    /** Set by an explicit `asc`/`desc` after the key; `undefined` follows `#sortDirection`. */
    descending?: boolean;
}

/**
 * Parses a `#sorted` value such as `priority desc, dueDate, title` into its levels: comma-separated
 * sort keys, each optionally followed by `asc` or `desc`, the way search's `orderBy` is written.
 * An empty value sorts by title.
 */
export function parseSortCriteria(value: string | null | undefined): SortCriterion[] {
    const criteria: SortCriterion[] = [];
    for (const level of (value ?? "").split(",")) {
        const words = level.trim().split(/\s+/);
        const last = words[words.length - 1].toLowerCase();
        const isDirection = words.length > 1 && (last === "asc" || last === "desc");
        const key = (isDirection ? words.slice(0, -1) : words).join(" ");
        if (key) {
            criteria.push({ key, descending: isDirection ? last === "desc" : undefined });
        }
    }
    return criteria.length > 0 ? criteria : [{ key: "title" }];
}

/**
 * Sorts the children of `parentNoteId` by the levels of `sortBy` (see {@link parseSortCriteria});
 * a level without its own direction, the folders-first grouping and the final title tiebreak
 * follow `reverse`; `#top` and `#bottom` take precedence over everything and ignore it.
 */
function sortNotes(
    parentNoteId: string,
    sortBy: string = "title",
    reverse = false,
    foldersFirst = false,
    sortNatural = false,
    _sortLocale?: string | null
) {
    const criteria = parseSortCriteria(sortBy);

    // sortLocale can not be empty string or null value, default value must be set to undefined.
    const sortLocale = _sortLocale || undefined;

    const sql = getSql();
    sql.transactional(() => {
        const note = becca.getNote(parentNoteId);
        if (!note) {
            throw new Error("Unable to find note");
        }

        const notes = note.getChildNotes();

        function fetchValue(note: BNote, key: string): string | null {
            let rawValue: string | null;

            if (key === "title") {
                const branch = note.getParentBranches()
                    .find((branch) => branch.parentNoteId === parentNoteId);
                const prefix = branch?.prefix;
                rawValue = prefix ? `${prefix} - ${note.title}` : note.title;
            } else {
                rawValue = ["dateCreated", "dateModified"].includes(key)
                    ? (note as any)[key]
                    : note.getLabelValue(key);
            }

            return typeof rawValue === "string" ? rawValue.toLowerCase() : rawValue;
        }

        function compare(a: string, b: string) {
            if (sortNatural) {
                return a.localeCompare(b, sortLocale, { numeric: true, sensitivity: "base" });
            }
            return a < b ? -1 : a > b ? 1 : 0;
        }

        // A child without the level's label sorts by its title in that label's place.
        function compareLevel(a: BNote, b: BNote, key: string, descending: boolean) {
            const valueA = fetchValue(a, key) ?? fetchValue(a, "title") ?? "";
            const valueB = fetchValue(b, key) ?? fetchValue(b, "title") ?? "";
            const result = compare(valueA, valueB);
            return descending ? -result : result;
        }

        notes.sort((a, b) => {
            const topA = fetchValue(a, "top");
            const topB = fetchValue(b, "top");

            if (topA !== topB) {
                if (topA === null) return 1;
                if (topB === null) return -1;
                return compare(topA, topB);
            }

            const bottomA = fetchValue(a, "bottom");
            const bottomB = fetchValue(b, "bottom");

            if (bottomA !== bottomB) {
                if (bottomA === null) return -1;
                if (bottomB === null) return 1;
                return compare(bottomB, bottomA);
            }

            if (foldersFirst) {
                const aHasChildren = a.hasChildren();
                const bHasChildren = b.hasChildren();

                // Folders group first ascending and last descending, as the single-key sort did.
                if (aHasChildren !== bHasChildren) {
                    return (aHasChildren ? -1 : 1) * (reverse ? -1 : 1);
                }
            }

            for (const { key, descending } of criteria) {
                const result = compareLevel(a, b, key, descending ?? reverse);
                if (result !== 0) {
                    return result;
                }
            }

            return compareLevel(a, b, "title", reverse);
        });

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
    const branchId = getSql().getValue<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND noteId = ? AND prefix = ?", [noteId, prefix]);
    const branch = becca.getBranch(branchId);

    if (branch) {
        if (!parentNoteId) {
            getLog().info(`Removing note '${noteId}' from parent '${parentNoteId}'`);

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

        const branchId = getSql().getValue<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND noteId = ? AND parentNoteId = ?", [noteId, parentNoteId]);
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
