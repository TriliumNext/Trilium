import type { Request } from "express";
import becca from "../../becca/becca.js";
import sql from "../../services/sql.js";
import { RelationMapPostResponse } from "@triliumnext/commons";

function getRelationMap(req: Request) {
    const { relationMapNoteId, noteIds } = req.body;

    const resp: RelationMapPostResponse = {
        // noteId => title
        noteTitles: {},
        relations: [],
        // relation name => inverse relation name
        inverseRelations: {
            internalLink: "internalLink"
        }
    };

    if (!Array.isArray(noteIds) || noteIds.length === 0) {
        return resp;
    }

    const questionMarks = noteIds.map((_noteId) => "?").join(",");

    const relationMapNote = becca.getNoteOrThrow(relationMapNoteId);

    const displayRelationsVal = relationMapNote.getLabelValue("displayRelations");
    const displayRelations = !displayRelationsVal ? [] : displayRelationsVal.split(",").map((token) => token.trim());

    const hideRelationsVal = relationMapNote.getLabelValue("hideRelations");
    const hideRelations = !hideRelationsVal ? [] : hideRelationsVal.split(",").map((token) => token.trim());

    const foundNoteIds = sql.getColumn<string>(/*sql*/`SELECT noteId FROM notes WHERE isDeleted = 0 AND noteId IN (${questionMarks})`, noteIds);
    const notes = becca.getNotes(foundNoteIds);

    for (const note of notes) {
        resp.noteTitles[note.noteId] = note.title;

        resp.relations = resp.relations.concat(
            note
                .getRelations()
                .filter((relation) => !relation.isAutoLink() || displayRelations.includes(relation.name))
                .filter((relation) => (displayRelations.length > 0 ? displayRelations.includes(relation.name) : !hideRelations.includes(relation.name)))
                .filter((relation) => noteIds.includes(relation.value))
                .map((relation) => ({
                    attributeId: relation.attributeId,
                    sourceNoteId: relation.noteId,
                    targetNoteId: relation.value,
                    name: relation.name
                }))
        );

        for (const relationDefinition of note.getRelationDefinitions()) {
            const def = relationDefinition.getDefinition();

            if (def.inverseRelation) {
                resp.inverseRelations[relationDefinition.getDefinedName()] = def.inverseRelation;
                resp.inverseRelations[def.inverseRelation] = relationDefinition.getDefinedName();
            }
        }
    }

    return resp;
}

export default {
    getRelationMap
};
