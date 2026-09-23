"use strict";

import becca from "./becca.js";
import { getLog } from "../services/log.js";
import { getHoistedNoteId } from "../services/context.js";

function isNotePathArchived(notePath: string[]) {
    const noteId = notePath[notePath.length - 1];
    const note = becca.notes[noteId];

    if (note.isArchived) {
        return true;
    }

    for (let i = 0; i < notePath.length - 1; i++) {
        const note = becca.notes[notePath[i]];

        // this is going through parents so archived must be inheritable
        if (note.hasInheritableArchivedLabel()) {
            return true;
        }
    }

    return false;
}

function getNoteTitle(childNoteId: string, parentNoteId?: string) {
    const childNote = becca.notes[childNoteId];
    const parentNote = parentNoteId ? becca.notes[parentNoteId] : null;

    if (!childNote) {
        getLog().info(`Cannot find note '${childNoteId}'`);
        return "[error fetching title]";
    }

    const title = childNote.getTitleOrProtected();

    const branch = parentNote ? becca.getBranchFromChildAndParent(childNote.noteId, parentNote.noteId) : null;

    return `${branch && branch.prefix ? `${branch.prefix} - ` : ""}${title}`;
}

/**
 * Similar to {@link getNoteTitle}, but also returns the icon class of the note.
 *
 * @returns An object containing the title and icon class of the note.
 */
function getNoteTitleAndIcon(childNoteId: string, parentNoteId?: string) {
    const childNote = becca.notes[childNoteId];
    const parentNote = parentNoteId ? becca.notes[parentNoteId] : null;

    if (!childNote) {
        getLog().info(`Cannot find note '${childNoteId}'`);
        return {
            title: "[error fetching title]"
        }
    }

    const title = childNote.getTitleOrProtected();
    const icon = childNote.getIcon();

    const branch = parentNote ? becca.getBranchFromChildAndParent(childNote.noteId, parentNote.noteId) : null;

    return {
        icon,
        title: `${branch && branch.prefix ? `${branch.prefix} - ` : ""}${title}`
    }
}

/**
 * Titles for each segment of a note path. Results under the same ancestors resolve the same
 * segments, so a caller ranking many of them can pass a cache and resolve each pair once.
 */
function getNoteTitleArrayForPath(notePathArray: string[], segmentTitles?: SegmentTitleCache) {
    if (!notePathArray || !Array.isArray(notePathArray)) {
        throw new Error(`${notePathArray} is not an array.`);
    }

    if (notePathArray.length === 1) {
        return [getNoteTitle(notePathArray[0])];
    }

    const titles: string[] = [];

    let parentNoteId = "root";
    let hoistedNotePassed = false;

    // this is a notePath from outside of hoisted subtree, so the full title path needs to be returned
    const hoistedNoteId = getHoistedNoteId();
    const outsideOfHoistedSubtree = !notePathArray.includes(hoistedNoteId);

    for (const noteId of notePathArray) {
        // start collecting path segment titles only after hoisted note
        if (hoistedNotePassed) {
            titles.push(segmentTitles ? getCachedNoteTitle(segmentTitles, noteId, parentNoteId) : getNoteTitle(noteId, parentNoteId));
        }

        if (!hoistedNotePassed && (noteId === hoistedNoteId || outsideOfHoistedSubtree)) {
            hoistedNotePassed = true;
        }

        parentNoteId = noteId;
    }

    return titles;
}

/** Nested by parent then child, so a lookup builds no key string and allocates nothing. */
export type SegmentTitleCache = Map<string, Map<string, string>>;

function getCachedNoteTitle(segmentTitles: SegmentTitleCache, noteId: string, parentNoteId: string) {
    let byChild = segmentTitles.get(parentNoteId);

    if (!byChild) {
        byChild = new Map();
        segmentTitles.set(parentNoteId, byChild);
    }

    let title = byChild.get(noteId);

    if (title === undefined) {
        title = getNoteTitle(noteId, parentNoteId);
        byChild.set(noteId, title);
    }

    return title;
}

function getNoteTitleForPath(notePathArray: string[]) {
    const titles = getNoteTitleArrayForPath(notePathArray);

    return titles.join(" › ");
}

export default {
    getNoteTitle,
    getNoteTitleArrayForPath,
    getNoteTitleAndIcon,
    getNoteTitleForPath,
    isNotePathArchived
};
