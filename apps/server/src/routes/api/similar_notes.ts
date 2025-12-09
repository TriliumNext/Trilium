"use strict";

import type { Request } from "express";

import similarityService from "../../becca/similarity.js";
import becca from "../../becca/becca.js";
import { SimilarNoteResponse } from "@triliumnext/commons";

async function getSimilarNotes(req: Request) {
    const noteId = req.params.noteId;

    const _note = becca.getNoteOrThrow(noteId);

    return (await similarityService.findSimilarNotes(noteId) satisfies SimilarNoteResponse);
}

export default {
    getSimilarNotes
};
