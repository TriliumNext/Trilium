import { SimilarNoteResponse } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import similarity from "../../becca/similarity.js";

async function getSimilarNotes(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    becca.getNoteOrThrow(noteId);

    return (await similarity.findSimilarNotes(noteId) satisfies SimilarNoteResponse);
}

export default {
    getSimilarNotes
};
