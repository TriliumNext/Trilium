import type { AttachmentRow, OptionNames } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import FAttachment, { type FAttachmentRow } from "../entities/fattachment.js";
import FAttribute, { type FAttributeRow } from "../entities/fattribute.js";
import FBranch, { type FBranchRow } from "../entities/fbranch.js";
import type { default as FNote, FNoteRow } from "../entities/fnote.js";
import type { EntityChange } from "../server_types.js";
import froca from "./froca.js";
import { invalidateNoteImages } from "./image_urls.js";
import LoadResults from "./load_results.js";
import noteAttributeCache from "./note_attribute_cache.js";
import options from "./options.js";

async function processEntityChanges(changes: EntityChange[]) {
    const entityChanges = changes.map(asDeletionIfErased);
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

                options.set(attributeEntity.name as OptionNames, attributeEntity.value);
                loadResults.addOption(attributeEntity.name as OptionNames);
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
        if (!entity || entity.isDeleted) {
            continue;
        }

        if (entityName === "branches" && !((entity as FBranchRow).parentNoteId in froca.notes)) {
            missingNoteIds.push((entity as FBranchRow).parentNoteId);
        } else if (entityName === "attributes") {
            const attributeEntity = entity as FAttributeRow;
            if (attributeEntity.type === "relation" && (attributeEntity.name === "template" || attributeEntity.name === "inherit") && !(attributeEntity.value in froca.notes)) {
                missingNoteIds.push(attributeEntity.value);
            }
        }
    }

    if (missingNoteIds.length > 0) {
        await froca.reloadNotes(missingNoteIds);
    }

    // Read from the entity changes rather than `loadResults`, which skips the notes froca has not
    // loaded: a text note can show the image of such a note without loading it.
    invalidateNoteImages(getImageNoteIds(entityChanges));

    if (!loadResults.isEmpty()) {
        if (loadResults.hasAttributeRelatedChanges()) {
            noteAttributeCache.invalidate();
        }

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

    if (ec.isErased || ec.entity?.isDeleted) {
        delete froca.notes[ec.entityId];
    } else {
        if (note.blobId !== (ec.entity as FNoteRow).blobId) {
            for (const key of Object.keys(froca.blobPromises)) {
                if (key.includes(note.noteId)) {
                    delete froca.blobPromises[key];
                }
            }

            // Only register as a content change if the protection status didn't change.
            // When isProtected changes, the blobId change is a side effect of re-encryption,
            // not a content edit. Registering it as content would cause the tree's content-only
            // filter to incorrectly skip the note update (since both changes share the same
            // componentId).
            if (ec.componentId && note.isProtected === (ec.entity as FNoteRow).isProtected) {
                loadResults.addNoteContent(note.noteId, ec.componentId);
            }
        }

        note.update(ec.entity as FNoteRow);
    }
}

async function processBranchChange(loadResults: LoadResults, ec: EntityChange) {
    let branch = froca.branches[ec.entityId];

    if (ec.isErased || ec.entity?.isDeleted) {
        if (!branch) {
            // `froca.addResp()` can drop the branch before its deletion arrives here, but the tree
            // still shows it while either note is loaded.
            const branchRow = ec.entity as FBranchRow | undefined;
            const isShown = !!branchRow
                && (branchRow.noteId in froca.notes || branchRow.parentNoteId in froca.notes);
            if (ec.componentId && isShown) {
                loadResults.addBranch(ec.entityId, ec.componentId);
            }
        } else {
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
    const attachment = froca.attachments[ec.entityId];
    const attachmentEntity = ec.entity as FAttachmentRow;

    if (ec.isErased || (ec.entity as any)?.isDeleted) {
        if (attachment) {
            const note = attachment.getNote();

            if (note && note.attachments) {
                note.attachments = note.attachments.filter((att) => att.attachmentId !== attachment.attachmentId);
            }

            loadResults.addAttachmentRow(attachmentEntity, ec.componentId);

            delete froca.attachments[ec.entityId];
        }

        return;
    }

    if (ec.entity) {
        delete froca.blobPromises[`attachments-${ec.entityId}`];
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

    loadResults.addAttachmentRow(attachmentEntity, ec.componentId);
}

/**
 * Turns the erasure of an entity froca holds into a deletion of froca's copy of its row. An erase
 * carries no row, and `LoadResults` and the widgets reading it need one to know what was removed.
 */
function asDeletionIfErased(ec: EntityChange): EntityChange {
    if (!ec.isErased) {
        return ec;
    }

    const row = getFrocaRow(ec);
    return row ? { ...ec, entity: { ...row, isDeleted: true } } : ec;
}

function getFrocaRow({ entityName, entityId }: EntityChange) {
    if (entityName === "notes") {
        const note = froca.notes[entityId];
        return note && {
            noteId: note.noteId, title: note.title, isProtected: note.isProtected,
            type: note.type, mime: note.mime, blobId: note.blobId
        } satisfies FNoteRow;
    } else if (entityName === "branches") {
        const branch = froca.branches[entityId];
        return branch && {
            branchId: branch.branchId, noteId: branch.noteId, parentNoteId: branch.parentNoteId,
            notePosition: branch.notePosition, prefix: branch.prefix,
            isExpanded: branch.isExpanded, fromSearchNote: branch.fromSearchNote
        } satisfies FBranchRow;
    } else if (entityName === "attributes") {
        const attribute = froca.attributes[entityId];
        return attribute && {
            attributeId: attribute.attributeId, noteId: attribute.noteId, type: attribute.type,
            name: attribute.name, value: attribute.value, position: attribute.position,
            isInheritable: attribute.isInheritable
        } satisfies FAttributeRow;
    } else if (entityName === "attachments") {
        const attachment = froca.attachments[entityId];
        return attachment && {
            attachmentId: attachment.attachmentId, ownerId: attachment.ownerId,
            role: attachment.role, mime: attachment.mime, title: attachment.title,
            utcDateModified: attachment.utcDateModified,
            utcDateScheduledForErasureSince: attachment.utcDateScheduledForErasureSince,
            contentLength: attachment.contentLength
        } satisfies AttachmentRow;
    }
    return undefined;
}

/**
 * Returns the notes whose image might have changed: a note's image is its content or one of its
 * attachments, such as `canvas-export.svg`. An erased attachment arrives without its row.
 */
function getImageNoteIds(entityChanges: EntityChange[]) {
    const noteIds: string[] = [];
    for (const ec of entityChanges) {
        if (ec.entityName === "notes") {
            noteIds.push(ec.entityId);
        } else if (ec.entityName === "attachments") {
            const ownerId = (ec.entity as FAttachmentRow | undefined)?.ownerId;
            if (ownerId) {
                noteIds.push(ownerId);
            }
        }
    }
    return noteIds;
}

export default {
    processEntityChanges
};
