import { isReificationStructuralName } from "@triliumnext/commons";
import type { RelationMapPostResponse, RelationMapRelation } from "@triliumnext/commons";

import type { Request } from "../../http_interface";
import becca from "../../becca/becca.js";
import type BAttribute from "../../becca/entities/battribute.js";
import type BNote from "../../becca/entities/bnote.js";
import reificationService from "../../services/reification.js";
import { getSql } from "../../services/sql/index.js";

function getRelationMap(req: Request) {
    const { relationMapNoteId, noteIds } = req.body;

    const resp: RelationMapPostResponse = {
        noteTitles: {},
        relations: [],
        inverseRelations: {
            internalLink: "internalLink"
        },
        reifications: []
    };

    if (!Array.isArray(noteIds) || noteIds.length === 0) {
        return resp;
    }

    const questionMarks = noteIds.map(() => "?").join(",");
    const relationMapNote = becca.getNoteOrThrow(relationMapNoteId);

    const displayRelationsVal = relationMapNote.getLabelValue("displayRelations");
    const displayRelations = !displayRelationsVal ? [] : displayRelationsVal.split(",").map((token) => token.trim());

    const hideRelationsVal = relationMapNote.getLabelValue("hideRelations");
    const hideRelations = !hideRelationsVal ? [] : hideRelationsVal.split(",").map((token) => token.trim());

    const foundNoteIds = getSql().getColumn<string>(/*sql*/`SELECT noteId FROM notes WHERE isDeleted = 0 AND noteId IN (${questionMarks})`, noteIds);
    const notes = becca.getNotes(foundNoteIds);
    const noteIdSet = new Set(foundNoteIds);
    const reificationIndex = reificationService.indexByAttributeId();
    const tokenIds = new Set<string>();

    function consider(attribute: BAttribute) {
        const token = reificationIndex.get(attribute.attributeId);
        if (!token || tokenIds.has(token.noteId)) {
            return;
        }
        const described = reificationService.toRelationMapReification(token);
        if (!described) {
            return;
        }
        tokenIds.add(token.noteId);
        resp.reifications.push(described);
    }

    for (const note of notes) {
        resp.noteTitles[note.noteId] = note.title;
        resp.relations = resp.relations.concat(visibleRelations(note, noteIdSet, displayRelations, hideRelations));

        for (const relationDefinition of note.getRelationDefinitions()) {
            const def = relationDefinition.getDefinition();
            if (def.inverseRelation) {
                resp.inverseRelations[relationDefinition.getDefinedName()] = def.inverseRelation;
                resp.inverseRelations[def.inverseRelation] = relationDefinition.getDefinedName();
            }
        }

        for (const relation of resp.relations) {
            if (relation.sourceNoteId !== note.noteId) {
                continue;
            }
            const attribute = becca.getAttribute(relation.attributeId);
            if (attribute) {
                consider(attribute);
            }
        }

        for (const owned of note.getOwnedAttributes()) {
            if (owned.type !== "label" || owned.isAutoLink() || isReificationStructuralName(owned.name)) {
                continue;
            }
            consider(owned);
        }
    }

    // Relations that touch a token, and reifications of those, a few levels deep
    // so an arrow can point at an arrow.
    let progressed = true;
    for (let pass = 0; progressed && pass < 8; pass++) {
        progressed = false;
        const allowed = new Set<string>([ ...noteIdSet, ...tokenIds ]);
        const sources: BNote[] = [ ...notes ];
        for (const tokenId of tokenIds) {
            const token = becca.getNote(tokenId);
            if (token) {
                sources.push(token);
            }
        }

        for (const note of sources) {
            // A relation that leaves a token may end on a note that was never placed on
            // this map. The map still needs that relation, so opening the token can
            // show the note it points at.
            const fromToken = tokenIds.has(note.noteId);
            for (const relation of visibleRelations(note, allowed, displayRelations, hideRelations, fromToken)) {
                if (resp.relations.some((existing) => existing.attributeId === relation.attributeId)) {
                    continue;
                }
                if (!tokenIds.has(note.noteId) && !tokenIds.has(relation.targetNoteId)) {
                    continue;
                }
                resp.relations.push(relation);
                progressed = true;
                const attribute = becca.getAttribute(relation.attributeId);
                const before = tokenIds.size;
                if (attribute) {
                    consider(attribute);
                }
                if (tokenIds.size !== before) {
                    progressed = true;
                }
            }
        }
    }

    return resp;
}

function visibleRelations(
    note: BNote,
    allowedTargets: Set<string>,
    displayRelations: string[],
    hideRelations: string[],
    allowAnyTarget = false
): RelationMapRelation[] {
    return note
        .getRelations()
        .filter((relation) => !relation.isAutoLink() || displayRelations.includes(relation.name))
        .filter((relation) => (displayRelations.length > 0 ? displayRelations.includes(relation.name) : !hideRelations.includes(relation.name)))
        .filter((relation) => !reificationService.isMapSuppressedRelation(relation.name) || displayRelations.includes(relation.name))
        .filter((relation) => allowAnyTarget || allowedTargets.has(relation.value))
        .map((relation) => ({
            attributeId: relation.attributeId,
            sourceNoteId: relation.noteId,
            targetNoteId: relation.value,
            name: relation.name
        }));
}

export default {
    getRelationMap
};
