import type { Request } from "express";
import BAttribute from "../../becca/entities/battribute";
import BNote from "../../becca/entities/bnote";
import becca from "../../becca/becca";
import type { BacklinkCountResponse } from "@triliumnext/commons";

function getFilteredBacklinks(note: BNote): BAttribute[] {
    return (
        note
            .getTargetRelations()
            // search notes have "ancestor" relations which are not interesting
            .filter((relation) => !!relation.getNote() && relation.getNote().type !== "search")
    );
}

function getBacklinkCount(req: Request) {
    const { noteId } = req.params;

    const note = becca.getNoteOrThrow(noteId);

    return {
        count: getFilteredBacklinks(note).length
    } satisfies BacklinkCountResponse;
}

export default {
    getBacklinkCount
}
