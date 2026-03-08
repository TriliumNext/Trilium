import { SimilarNoteResponse } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import similarityService from "../../becca/similarity.js";

async function getSimilarNotes(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;

    const _note = becca.getNoteOrThrow(noteId);

    return (await similarityService.findSimilarNotes(noteId) satisfies SimilarNoteResponse);
}

export default {
    getSimilarNotes
};
