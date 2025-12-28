import eventService from "./events.js";
import scriptService from "./script.js";
import treeService from "./tree.js";
import noteService from "./notes.js";
import becca from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import oneTimeTimer from "./one_time_timer.js";
import type BNote from "../becca/entities/bnote.js";
import type AbstractBeccaEntity from "../becca/entities/abstract_becca_entity.js";
import type { DefinitionObject } from "./promoted_attribute_definition_interface.js";

type Handler = (definition: DefinitionObject, note: BNote, targetNote: BNote) => void;

function runAttachedRelations(note: BNote, relationName: string, originEntity: AbstractBeccaEntity<any>) {
    if (!note) {
        return;
    }

    // the same script note can get here with multiple ways, but execute only once
    const notesToRun = new Set(
        note
            .getRelations(relationName)
            .map((relation) => relation.getTargetNote())
            .filter((note) => !!note) as BNote[]
    );

    for (const noteToRun of notesToRun) {
        scriptService.executeNoteNoException(noteToRun, { originEntity });
    }
}

eventService.subscribe(eventService.NOTE_TITLE_CHANGED, (note) => {
    runAttachedRelations(note, "runOnNoteTitleChange", note);

    if (!note.isRoot()) {
        const noteFromCache = becca.notes[note.noteId];

        if (!noteFromCache) {
            return;
        }

        for (const parentNote of noteFromCache.parents) {
            if (parentNote.hasLabel("sorted")) {
                treeService.sortNotesIfNeeded(parentNote.noteId);
            }
        }
    }
});

eventService.subscribe([eventService.ENTITY_CHANGED, eventService.ENTITY_DELETED], ({ entityName, entity }) => {
    if (entityName === "attributes") {
        runAttachedRelations(entity.getNote(), "runOnAttributeChange", entity);

        if (entity.type === "label" && ["sorted", "sortDirection", "sortFoldersFirst", "sortNatural", "sortLocale"].includes(entity.name)) {
            handleSortedAttribute(entity);
        } else if (entity.type === "label") {
            handleMaybeSortingLabel(entity);
        }
    } else if (entityName === "notes") {
        // ENTITY_DELETED won't trigger anything since all branches/attributes are already deleted at this point
        runAttachedRelations(entity, "runOnNoteChange", entity);
    }
});

eventService.subscribe(eventService.ENTITY_CHANGED, ({ entityName, entity }) => {
    if (entityName === "branches") {
        const parentNote = becca.getNote(entity.parentNoteId);

        if (parentNote?.hasLabel("sorted")) {
            treeService.sortNotesIfNeeded(parentNote.noteId);
        }

        const childNote = becca.getNote(entity.noteId);

        if (childNote) {
            runAttachedRelations(childNote, "runOnBranchChange", entity);
        }
    }
});

eventService.subscribe(eventService.NOTE_CONTENT_CHANGE, ({ entity }) => {
    runAttachedRelations(entity, "runOnNoteContentChange", entity);
});

eventService.subscribe(eventService.ENTITY_CREATED, ({ entityName, entity }) => {
    if (entityName === "attributes") {
        runAttachedRelations(entity.getNote(), "runOnAttributeCreation", entity);

        if (entity.type === "relation" && entity.name === "template") {
            const note = becca.getNote(entity.noteId);
            if (!note) {
                return;
            }

            const templateNote = becca.getNote(entity.value);

            if (!templateNote) {
                return;
            }

            const content = note.getContent();

            if (
                ["text", "code", "mermaid", "canvas", "relationMap", "mindMap", "webView"].includes(note.type) &&
                typeof content === "string" &&
                // if the note has already content we're not going to overwrite it with template's one
                (!content || content.trim().length === 0) &&
                templateNote.hasStringContent()
            ) {
                const templateNoteContent = templateNote.getContent();

                if (templateNoteContent) {
                    note.setContent(templateNoteContent);
                }

                note.type = templateNote.type;
                note.mime = templateNote.mime;
                note.save();
            }

            // we'll copy the children notes only if there's none so far
            // this protects against e.g. multiple assignment of template relation resulting in having multiple copies of the subtree
            if (note.getChildNotes().length === 0 && !note.isDescendantOfNote(templateNote.noteId)) {
                noteService.duplicateSubtreeWithoutRoot(templateNote.noteId, note.noteId);
            }
        } else if (entity.type === "label" && ["sorted", "sortDirection", "sortFoldersFirst", "sortNatural", "sortLocale"].includes(entity.name)) {
            handleSortedAttribute(entity);
        } else if (entity.type === "label") {
            handleMaybeSortingLabel(entity);
        }
    } else if (entityName === "branches") {
        runAttachedRelations(entity.getNote(), "runOnBranchCreation", entity);

        if (entity.parentNote?.hasLabel("sorted")) {
            treeService.sortNotesIfNeeded(entity.parentNoteId);
        }
    } else if (entityName === "notes") {
        runAttachedRelations(entity, "runOnNoteCreation", entity);
    }
});

eventService.subscribe(eventService.CHILD_NOTE_CREATED, ({ parentNote, childNote }) => {
    runAttachedRelations(parentNote, "runOnChildNoteCreation", childNote);
});

function processInverseRelations(entityName: string, entity: BAttribute, handler: Handler) {
    if (entityName === "attributes" && entity.type === "relation") {
        const note = entity.getNote();
        const relDefinitions = note.getLabels(`relation:${entity.name}`);

        for (const relDefinition of relDefinitions) {
            const definition = relDefinition.getDefinition();

            if (definition.inverseRelation && definition.inverseRelation.trim()) {
                const targetNote = entity.getTargetNote();

                if (targetNote) {
                    handler(definition, note, targetNote);
                }
            }
        }
    }
}

function handleSortedAttribute(entity: BAttribute) {
    treeService.sortNotesIfNeeded(entity.noteId);

    if (entity.isInheritable) {
        const note = becca.notes[entity.noteId];

        if (note) {
            for (const noteId of note.getSubtreeNoteIds()) {
                treeService.sortNotesIfNeeded(noteId);
            }
        }
    }
}

function handleMaybeSortingLabel(entity: BAttribute) {
    // check if this label is used for sorting, if yes force re-sort
    const note = becca.notes[entity.noteId];

    // this will not work on deleted notes, but in that case we don't really need to re-sort
    if (note) {
        for (const parentNote of note.getParentNotes()) {
            const sorted = parentNote.getLabelValue("sorted");
            if (sorted === null) {
                // checking specifically for null since that means the label doesn't exist
                // empty valued "sorted" is still valid
                continue;
            }

            if (
                sorted.includes(entity.name) || // hacky check if this label is used in the sort
                entity.name === "top" ||
                entity.name === "bottom"
            ) {
                treeService.sortNotesIfNeeded(parentNote.noteId);
            }
        }
    }
}

eventService.subscribe(eventService.ENTITY_CHANGED, ({ entityName, entity }) => {
    processInverseRelations(entityName, entity, (definition, note, targetNote) => {
        // we need to make sure that also target's inverse attribute exists and if not, then create it
        // inverse attribute has to target our note as well
        const hasInverseAttribute = targetNote.getRelations(definition.inverseRelation).some((attr) => attr.value === note.noteId);

        if (!hasInverseAttribute) {
            new BAttribute({
                noteId: targetNote.noteId,
                type: "relation",
                name: definition.inverseRelation || "",
                value: note.noteId,
                isInheritable: entity.isInheritable
            }).save();

            // becca will not be updated before we'll check from the other side which would create infinite relation creation (#2269)
            targetNote.invalidateThisCache();
        }
    });
});

eventService.subscribe(eventService.ENTITY_DELETED, ({ entityName, entity }) => {
    processInverseRelations(entityName, entity, (definition: DefinitionObject, note: BNote, targetNote: BNote) => {
        // if one inverse attribute is deleted, then the other should be deleted as well
        const relations = targetNote.getOwnedRelations(definition.inverseRelation);

        for (const relation of relations) {
            if (relation.value === note.noteId) {
                relation.markAsDeleted();
            }
        }
    });

    if (entityName === "branches") {
        runAttachedRelations(entity.getNote(), "runOnBranchDeletion", entity);
    }

    if (entityName === "notes" && entity.noteId.startsWith("_")) {
        // "named" note has been deleted, we will probably need to rebuild the hidden subtree
        // scheduling so that bulk deletes won't trigger so many checks
        oneTimeTimer.scheduleExecution("hidden-subtree-check", 1000, () => hiddenSubtreeService.checkHiddenSubtree());
    }
});

export default {
    runAttachedRelations
};
