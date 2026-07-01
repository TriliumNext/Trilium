import { SimilarNoteResponse } from "@triliumnext/commons";
import type { Request } from "express";

import { getBecca } from "../../becca/becca.js";
import similarity from "../../becca/similarity.js";

async function getSimilarNotes(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    getBecca().getNoteOrThrow(noteId);

    return (await similarity.findSimilarNotes(noteId) satisfies SimilarNoteResponse);
}

export default {
    getSimilarNotes
};
