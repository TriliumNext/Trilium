"use strict";

import becca from "./becca.js";
import { getLog } from "../services/log.js";
import { getContext } from "src/services/context.js";

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

function getNoteTitleArrayForPath(notePathArray: string[]) {
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
    const hoistedNoteId = getContext().getHoistedNoteId();
    const outsideOfHoistedSubtree = !notePathArray.includes(hoistedNoteId);

    for (const noteId of notePathArray) {
        // start collecting path segment titles only after hoisted note
        if (hoistedNotePassed) {
            const title = getNoteTitle(noteId, parentNoteId);

            titles.push(title);
        }

        if (!hoistedNotePassed && (noteId === hoistedNoteId || outsideOfHoistedSubtree)) {
            hoistedNotePassed = true;
        }

        parentNoteId = noteId;
    }

    return titles;
}

function getNoteTitleForPath(notePathArray: string[]) {
    const titles = getNoteTitleArrayForPath(notePathArray);

    return titles.join(" / ");
}

export default {
    getNoteTitle,
    getNoteTitleAndIcon,
    getNoteTitleForPath,
    isNotePathArchived
};
