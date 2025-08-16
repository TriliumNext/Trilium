import LoadResults from "./load_results.js";
import froca from "./froca.js";
import utils from "./utils.js";
import options from "./options.js";
import noteAttributeCache from "./note_attribute_cache.js";
import FBranch, { type FBranchRow } from "../entities/fbranch.js";
import FAttribute, { type FAttributeRow } from "../entities/fattribute.js";
import FAttachment, { type FAttachmentRow } from "../entities/fattachment.js";
import type { default as FNote, FNoteRow } from "../entities/fnote.js";
import type { EntityChange } from "../server_types.js";

async function processEntityChanges(entityChanges: EntityChange[]) {
    const loadResults = new LoadResults(entityChanges);

    for (const ec of entityChanges) {
        try {
            if (ec.entityName === "notes") {
                processNoteChange(loadResults, ec);
            } else if (ec.entityName === "branches") {
                await processBranchChange(loadResults, ec);
            } else if (ec.entityName === "attributes") {
                processAttributeChange(loadResults, ec);
            } else if (ec.entityName === "note_reordering") {
                processNoteReordering(loadResults, ec);
            } else if (ec.entityName === "revisions") {
                loadResults.addRevision(ec.entityId, ec.noteId, ec.componentId);
            } else if (ec.entityName === "options") {
                const attributeEntity = ec.entity as FAttributeRow;
                if (attributeEntity.name === "openNoteContexts") {
                    continue; // only noise
                }

                options.set(attributeEntity.name, attributeEntity.value);

                loadResults.addOption(attributeEntity.name);
            } else if (ec.entityName === "attachments") {
                processAttachment(loadResults, ec);
            } else if (ec.entityName === "blobs") {
                // NOOP - these entities are handled at the backend level and don't require frontend processing
            } else if (ec.entityName === "etapi_tokens") {
                loadResults.hasEtapiTokenChanges = true;
            } else {
                throw new Error(`Unknown entityName '${ec.entityName}'`);
            }
        } catch (e: any) {
            throw new Error(`Can't process entity ${JSON.stringify(ec)} with error ${e.message} ${e.stack}`);
        }
    }

    // froca is supposed to contain all notes currently being visible to the users in the tree / otherwise being processed
    // and their complete "ancestor relationship", so it's always possible to go up in the hierarchy towards the root.
    // To this we count: standard parent-child relationships and template/inherit relations (attribute inheritance follows them).
    // Here we watch for changes which might violate this principle - e.g., an introduction of a new "inherit" relation might
    // mean we need to load the target of the relation (and then perhaps transitively the whole note path of this target).
    const missingNoteIds: string[] = [];

    for (const { entityName, entity } of entityChanges) {
        if (!entity) {
            // if erased
            continue;
        }

        if (entityName === "branches" && !((entity as FBranchRow).parentNoteId in froca.notes)) {
            missingNoteIds.push((entity as FBranchRow).parentNoteId);
        } else if (entityName === "attributes") {
            let attributeEntity = entity as FAttributeRow;
            if (attributeEntity.type === "relation" && (attributeEntity.name === "template" || attributeEntity.name === "inherit") && !(attributeEntity.value in froca.notes)) {
                missingNoteIds.push(attributeEntity.value);
            }
        }
    }

    if (missingNoteIds.length > 0) {
        await froca.reloadNotes(missingNoteIds);
    }

    if (!loadResults.isEmpty()) {
        if (loadResults.hasAttributeRelatedChanges()) {
            noteAttributeCache.invalidate();
        }

        const appContext = (await import("../components/app_context.js")).default;
        await appContext.triggerEvent("entitiesReloaded", { loadResults });
    }
}

function processNoteChange(loadResults: LoadResults, ec: EntityChange) {
    const note = froca.notes[ec.entityId];

    if (!note) {
        // if this note has not been requested before then it's not part of froca's cached subset, and
        // we're not interested in it
        return;
    }

    loadResults.addNote(ec.entityId, ec.componentId);

    if (ec.isErased && ec.entityId in froca.notes) {
        utils.reloadFrontendApp(`${ec.entityName} '${ec.entityId}' is erased, need to do complete reload.`);
        return;
    }

    if (ec.isErased || ec.entity?.isDeleted) {
        delete froca.notes[ec.entityId];
    } else {
        if (note.blobId !== (ec.entity as FNoteRow).blobId) {
            for (const key of Object.keys(froca.blobPromises)) {
                if (key.includes(note.noteId)) {
                    delete froca.blobPromises[key];
                }
            }

            if (ec.componentId) {
                loadResults.addNoteContent(note.noteId, ec.componentId);
            }
        }

        note.update(ec.entity as FNoteRow);
    }
}

async function processBranchChange(loadResults: LoadResults, ec: EntityChange) {
    if (ec.isErased && ec.entityId in froca.branches) {
        utils.reloadFrontendApp(`${ec.entityName} '${ec.entityId}' is erased, need to do complete reload.`);
        return;
    }

    let branch = froca.branches[ec.entityId];

    if (ec.isErased || ec.entity?.isDeleted) {
        if (branch) {
            const childNote = froca.notes[branch.noteId];
            const parentNote = froca.notes[branch.parentNoteId];

            if (childNote) {
                childNote.parents = childNote.parents.filter((parentNoteId) => parentNoteId !== branch.parentNoteId);
                delete childNote.parentToBranch[branch.parentNoteId];
            }

            if (parentNote) {
                parentNote.children = parentNote.children.filter((childNoteId) => childNoteId !== branch.noteId);
                delete parentNote.childToBranch[branch.noteId];
            }

            if (ec.componentId) {
                loadResults.addBranch(ec.entityId, ec.componentId);
            }

            delete froca.branches[ec.entityId];
        }

        return;
    }

    if (ec.componentId) {
        loadResults.addBranch(ec.entityId, ec.componentId);
    }

    const branchEntity = ec.entity as FBranchRow;
    const childNote = froca.notes[branchEntity.noteId];
    let parentNote: FNote | null = froca.notes[branchEntity.parentNoteId];

    if (childNote && !childNote.isRoot() && !parentNote) {
        // a branch cannot exist without the parent
        // a note loaded into froca has to also contain all its ancestors,
        // this problem happened, e.g., in sharing where _share was hidden and thus not loaded
        // sharing meant cloning into _share, which crashed because _share was not loaded
        parentNote = await froca.getNote(branchEntity.parentNoteId);
    }

    if (branch) {
        branch.update(ec.entity as FBranch);
    } else if (childNote || parentNote) {
        froca.branches[ec.entityId] = branch = new FBranch(froca, branchEntity);
    }

    if (childNote) {
        childNote.addParent(branch.parentNoteId, branch.branchId);
    }

    if (parentNote) {
        parentNote.addChild(branch.noteId, branch.branchId);
    }
}

function processNoteReordering(loadResults: LoadResults, ec: EntityChange) {
    const parentNoteIdsToSort = new Set<string>();

    for (const branchId in ec.positions) {
        const branch = froca.branches[branchId];

        if (branch) {
            branch.notePosition = ec.positions[branchId];

            parentNoteIdsToSort.add(branch.parentNoteId);
        }
    }

    for (const parentNoteId of parentNoteIdsToSort) {
        const parentNote = froca.notes[parentNoteId];

        if (parentNote) {
            parentNote.sortChildren();
        }
    }

    if (ec.componentId) {
        loadResults.addNoteReordering(ec.entityId, ec.componentId);
    }
}

function processAttributeChange(loadResults: LoadResults, ec: EntityChange) {
    let attribute = froca.attributes[ec.entityId];

    if (ec.isErased && ec.entityId in froca.attributes) {
        utils.reloadFrontendApp(`${ec.entityName} '${ec.entityId}' is erased, need to do complete reload.`);
        return;
    }

    if (ec.isErased || ec.entity?.isDeleted) {
        if (attribute) {
            const sourceNote = froca.notes[attribute.noteId];
            const targetNote = attribute.type === "relation" && froca.notes[attribute.value];

            if (sourceNote) {
                sourceNote.attributes = sourceNote.attributes.filter((attributeId) => attributeId !== attribute.attributeId);
            }

            if (targetNote) {
                targetNote.targetRelations = targetNote.targetRelations.filter((attributeId) => attributeId !== attribute.attributeId);
            }

            if (ec.componentId) {
                loadResults.addAttribute(ec.entityId, ec.componentId);
            }

            delete froca.attributes[ec.entityId];
        }

        return;
    }

    if (ec.componentId) {
        loadResults.addAttribute(ec.entityId, ec.componentId);
    }

    const attributeEntity = ec.entity as FAttributeRow;
    const sourceNote = froca.notes[attributeEntity.noteId];
    const targetNote = attributeEntity.type === "relation" && froca.notes[attributeEntity.value];

    if (attribute) {
        attribute.update(ec.entity as FAttributeRow);
    } else if (sourceNote || targetNote) {
        attribute = new FAttribute(froca, ec.entity as FAttributeRow);

        froca.attributes[attribute.attributeId] = attribute;

        if (sourceNote && !sourceNote.attributes.includes(attribute.attributeId)) {
            sourceNote.attributes.push(attribute.attributeId);
        }

        if (targetNote && !targetNote.targetRelations.includes(attribute.attributeId)) {
            targetNote.targetRelations.push(attribute.attributeId);
        }
    }
}

function processAttachment(loadResults: LoadResults, ec: EntityChange) {
    if (ec.isErased && ec.entityId in froca.attachments) {
        utils.reloadFrontendApp(`${ec.entityName} '${ec.entityId}' is erased, need to do complete reload.`);
        return;
    }

    const attachment = froca.attachments[ec.entityId];
    const attachmentEntity = ec.entity as FAttachmentRow;

    if (ec.isErased || (ec.entity as any)?.isDeleted) {
        if (attachment) {
            const note = attachment.getNote();

            if (note && note.attachments) {
                note.attachments = note.attachments.filter((att) => att.attachmentId !== attachment.attachmentId);
            }

            loadResults.addAttachmentRow(attachmentEntity);

            delete froca.attachments[ec.entityId];
        }

        return;
    }

    if (ec.entity) {
        if (attachment) {
            attachment.update(ec.entity as FAttachmentRow);
        } else {
            const attachmentRow = ec.entity as FAttachmentRow;
            const note = froca.notes[attachmentRow.ownerId];

            if (note?.attachments) {
                note.attachments.push(new FAttachment(froca, attachmentRow));
            }
        }
    }

    loadResults.addAttachmentRow(attachmentEntity);
}

export default {
    processEntityChanges
};
