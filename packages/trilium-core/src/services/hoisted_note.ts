import { getBecca } from "../becca/becca.js";
import * as cls from "./context.js";

function getHoistedNoteId() {
    return cls.getHoistedNoteId();
}

function isHoistedInHiddenSubtree() {
    const hoistedNoteId = getHoistedNoteId();

    if (hoistedNoteId === "root") {
        return false;
    } else if (hoistedNoteId === "_hidden") {
        return true;
    }

    const hoistedNote = getBecca().getNote(hoistedNoteId);

    if (!hoistedNote) {
        throw new Error(`Cannot find hoisted note '${hoistedNoteId}'`);
    }

    return hoistedNote.isHiddenCompletely();
}

function getWorkspaceNote() {
    const hoistedNote = getBecca().getNote(getHoistedNoteId());

    if (hoistedNote && (hoistedNote.isRoot() || hoistedNote.hasLabel("workspace"))) {
        return hoistedNote;
    } else {
        return getBecca().getRoot();
    }
}

export default {
    getHoistedNoteId,
    getWorkspaceNote,
    isHoistedInHiddenSubtree
};
