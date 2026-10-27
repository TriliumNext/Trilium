"use strict";

import { parseSortCriteria, type SortCriterion } from "@triliumnext/commons";

import { getLog } from "./log.js";
import { compareSortValues } from "./utils/sort_values.js";
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

    // Virtual notes (e.g. the in-app help) exist only in becca — a persisted branch
    // referencing them would dangle after upgrades and on other sync instances.
    if (becca.getNote(childNoteId)?.isVirtual) {
        return { branch: null, success: false, message: `Note '${childNoteId}' is a virtual note and cannot be cloned or moved.` };
    }

    if (becca.getNote(parentNoteId)?.isVirtual) {
        return { branch: null, success: false, message: `Note '${parentNoteId}' is a virtual note and cannot receive children.` };
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

/**
 * Sorts the children of `parentNoteId` by the levels of `sortBy`; `reverse` is the direction of a
 * level without its own, of the `#sortFoldersFirst` grouping and of ties, never of a `first`/`last`
 * grouping level or of the `#top` and `#bottom` levels {@link withPinningLevels} adds.
 */
function sortNotes(
    parentNoteId: string,
    sortBy: string = "title",
    reverse = false,
    foldersFirst = false,
    sortNatural = false,
    _sortLocale?: string | null
) {
    const levels = withPinningLevels(parseSortCriteria(sortBy), foldersFirst, reverse);

    // sortLocale can not be empty string or null value, default value must be set to undefined.
    const sortLocale = _sortLocale || undefined;

    const sql = getSql();
    sql.transactional(() => {
        const note = becca.getNote(parentNoteId);
        if (!note) {
            throw new Error("Unable to find note");
        }

        const notes = note.getChildNotes();

        function fetchValue(note: BNote, key: string, isLabel = true): string | null {
            let rawValue: string | null = null;

            if (isLabel) {
                rawValue = note.getLabelValue(key);
            } else if (key === "title") {
                const branch = note.getParentBranches()
                    .find((branch) => branch.parentNoteId === parentNoteId);
                const prefix = branch?.prefix;
                rawValue = prefix ? `${prefix} - ${note.title}` : note.title;
            } else if (key === "dateCreated" || key === "dateModified") {
                rawValue = note[key] ?? null;
            } else if (key === "folders") {
                rawValue = note.hasChildren() ? "" : null;
            }

            return typeof rawValue === "string" ? rawValue.toLowerCase() : rawValue;
        }

        function compare(a: string, b: string) {
            if (sortNatural) {
                return a.localeCompare(b, sortLocale, { numeric: true, sensitivity: "base" });
            }
            return a < b ? -1 : a > b ? 1 : 0;
        }

        function compareReversed(a: string, b: string) {
            return -compare(a, b);
        }

        // A child without the label sorts after every child that has it, whichever direction the
        // level runs in, so only the values both children have follow `descending`. Two children
        // without it tie, leaving the next level to decide.
        function compareLevel(a: BNote, b: BNote, level: SortCriterion, descending: boolean) {
            return compareSortValues(
                fetchValue(a, level.key, level.isLabel),
                fetchValue(b, level.key, level.isLabel),
                descending ? compareReversed : compare
            );
        }

        // Orders by whether each child has the label (or a value of the property), ignoring the
        // value and `reverse`.
        function compareGroup(a: BNote, b: BNote, { key, isLabel, group }: SortCriterion) {
            const hasA = fetchValue(a, key, isLabel) !== null;
            if (hasA === (fetchValue(b, key, isLabel) !== null)) {
                return 0;
            }
            return (hasA ? -1 : 1) * (group === "last" ? -1 : 1);
        }

        notes.sort((a, b) => {
            for (const level of levels) {
                const result = level.group
                    ? compareGroup(a, b, level)
                    : compareLevel(a, b, level, level.descending ?? reverse);
                if (result !== 0) {
                    return result;
                }
            }

            return compareLevel(a, b, { key: "title", isLabel: false }, reverse);
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

/**
 * Puts `#top asc` before `criteria` unless they name `#top`, then `#bottom last, #bottom desc`
 * unless they name `#bottom`. Unless they name `folders`, `#sortFoldersFirst` adds `folders first`
 * (`folders last` when `reverse`) right after the last `#top` or `#bottom` level.
 */
function withPinningLevels(criteria: SortCriterion[], foldersFirst: boolean, reverse: boolean) {
    const names = (key: string, isLabel: boolean) =>
        criteria.some((level) => level.isLabel === isLabel && level.key === key);

    const levels: SortCriterion[] = [];
    if (!names("top", true)) {
        levels.push({ key: "top", isLabel: true, descending: false });
    }
    if (!names("bottom", true)) {
        levels.push(
            { key: "bottom", isLabel: true, group: "last" },
            { key: "bottom", isLabel: true, descending: true }
        );
    }
    levels.push(...criteria);

    if (foldersFirst && !names("folders", false)) {
        const lastPinning = levels.findLastIndex(
            ({ key, isLabel }) => isLabel && (key === "top" || key === "bottom")
        );
        levels.splice(lastPinning + 1, 0, {
            key: "folders", isLabel: false, group: reverse ? "last" : "first"
        });
    }
    return levels;
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
