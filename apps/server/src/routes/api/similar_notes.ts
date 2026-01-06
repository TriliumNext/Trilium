import { SimilarNoteResponse } from "@triliumnext/commons";
import { similarity } from "@triliumnext/core";
import type { Request } from "express";

import becca from "../../becca/becca.js";

async function getSimilarNotes(req: Request) {
    const noteId = req.params.noteId;

    const _note = becca.getNoteOrThrow(noteId);

    return (await similarity.findSimilarNotes(noteId) satisfies SimilarNoteResponse);
}

export default {
    getSimilarNotes
};
