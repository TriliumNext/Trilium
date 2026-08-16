import type { BlobRow, EntityChange } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import dateUtils from "./utils/date.js";
import { getLog } from "./log.js";
import { randomString } from "./utils/index.js";
import { getSql } from "./sql/index.js";
import * as cls from "./context.js";
import events from "./events.js";
import blobService from "./blob.js";
import getInstanceId from "./instance_id.js";

let maxEntityChangeId = 0;

function putEntityChangeWithInstanceId(origEntityChange: EntityChange, instanceId: string) {
    const ec = { ...origEntityChange, instanceId };

    putEntityChange(ec);
}

function putEntityChangeWithForcedChange(origEntityChange: EntityChange) {
    const ec = { ...origEntityChange, changeId: null };

    putEntityChange(ec);
}

/**
 * Re-queues an existing entity change so the next sync sends it to the rest of the cluster again.
 *
 * Beyond forcing a new change ID, this takes ownership of the row, and that is the point of it. A
 * change carries the instance ID of wherever it came from, and both directions of the protocol use
 * that to avoid echoing a change back to its origin: `pushChanges` skips changes stamped with the
 * sync server's ID, and a server serving `/api/sync/changed` skips the ones stamped with the
 * requesting client's. Either filter assumes the other side still holds what it once sent.
 *
 * A sector re-queue happens exactly when that assumption has already failed — the two sides disagree
 * about the sector's contents, e.g. because the server purged a blob that briefly looked unreferenced
 * while a push was still arriving, or because a peer was restored from an older backup. Keeping the
 * original stamp would mean the only instance still holding the data refuses to send it, so the
 * re-queue would produce a change nobody transmits and the sector could never converge. Stamping the
 * local instance makes the row transmissible again; a receiver that turns out to have it already
 * applies it as a no-op, since the hashes match.
 */
function requeueEntityChange(origEntityChange: EntityChange) {
    const ec = { ...origEntityChange, changeId: null, instanceId: null };

    putEntityChange(ec);
}

function putEntityChange(origEntityChange: EntityChange) {
    const ec = { ...origEntityChange };

    delete ec.id;

    if (!ec.changeId) {
        ec.changeId = randomString(12);
    }

    ec.componentId = ec.componentId || cls.getComponentId() || "NA"; // NA = not available
    ec.instanceId = ec.instanceId || getInstanceId();
    ec.isSynced = ec.isSynced ? 1 : 0;
    ec.isErased = ec.isErased ? 1 : 0;
    ec.id = getSql().replace("entity_changes", ec);

    if (ec.id) {
        maxEntityChangeId = Math.max(maxEntityChangeId, ec.id);
    }

    cls.putEntityChange(ec);
}

/**
 * Re-records a blob's entity change from what is stored on it now, leaving the blob itself alone.
 *
 * A blob is identified by a hash of its content, so it is normally recorded once, when it is written,
 * and never again. Its text representation is not part of that identity and is filled in afterwards —
 * by OCR, or by carrying the text across a change of protection — which leaves the recorded hash
 * describing a row that no longer matches, and sync comparing against something that was never stored.
 */
function putBlobEntityChange(blobId: string) {
    const blob = getSql().getRowOrNull<Pick<BlobRow, "blobId" | "content" | "utcDateModified" | "textRepresentation">>(
        /*sql*/`SELECT blobId, content, textRepresentation, utcDateModified FROM blobs WHERE blobId = ?`,
        [blobId]
    );

    if (!blob) {
        return;
    }

    putEntityChange({
        entityName: "blobs",
        entityId: blobId,
        hash: blobService.calculateContentHash(blob),
        isErased: false,
        utcDateChanged: blob.utcDateModified,
        isSynced: true // blobs are always synced
    } as EntityChange);
}

function putNoteReorderingEntityChange(parentNoteId: string, componentId?: string) {
    putEntityChange({
        entityName: "note_reordering",
        entityId: parentNoteId,
        hash: "N/A",
        isErased: false,
        utcDateChanged: dateUtils.utcNowDateTime(),
        isSynced: true,
        componentId,
        instanceId: getInstanceId()
    });

    events.emit(events.ENTITY_CHANGED, {
        entityName: "note_reordering",
        entity: getSql().getMap(/*sql*/`SELECT branchId, notePosition FROM branches WHERE isDeleted = 0 AND parentNoteId = ?`, [parentNoteId])
    });
}

function putEntityChangeForOtherInstances(ec: EntityChange) {
    putEntityChange({
        ...ec,
        changeId: null,
        instanceId: null
    });
}

function addEntityChangesForSector(entityName: string, sector: string) {
    const sql = getSql();
    const entityChanges = sql.getRows<EntityChange>(/*sql*/`SELECT * FROM entity_changes WHERE entityName = ? AND SUBSTR(entityId, 1, 1) = ?`, [entityName, sector]);

    let entitiesInserted = entityChanges.length;

    sql.transactional(() => {
        if (entityName === "blobs") {
            entitiesInserted += addEntityChangesForDependingEntity(sector, "notes", "noteId");
            entitiesInserted += addEntityChangesForDependingEntity(sector, "attachments", "attachmentId");
            entitiesInserted += addEntityChangesForDependingEntity(sector, "revisions", "revisionId");
        }

        for (const ec of entityChanges) {
            requeueEntityChange(ec);
        }
    });

    getLog().info(`Added sector ${sector} of '${entityName}' (${entitiesInserted} entities) to the sync queue.`);
}

function addEntityChangesForDependingEntity(sector: string, tableName: string, primaryKeyColumn: string) {
    // problem in blobs might be caused by problem in entity referencing the blob
    const dependingEntityChanges = getSql().getRows<EntityChange>(
        `
                SELECT dep_change.*
                FROM entity_changes orig_sector
                JOIN ${tableName} ON ${tableName}.blobId = orig_sector.entityId
                JOIN entity_changes dep_change ON dep_change.entityName = '${tableName}' AND dep_change.entityId = ${tableName}.${primaryKeyColumn}
                WHERE orig_sector.entityName = 'blobs' AND SUBSTR(orig_sector.entityId, 1, 1) = ?`,
        [sector]
    );

    for (const ec of dependingEntityChanges) {
        requeueEntityChange(ec);
    }

    return dependingEntityChanges.length;
}

function cleanupEntityChangesForMissingEntities(entityName: string, entityPrimaryKey: string) {
    getSql().execute(`
    DELETE
    FROM entity_changes
    WHERE
        isErased = 0
        AND entityName = '${entityName}'
        AND entityId NOT IN (SELECT ${entityPrimaryKey} FROM ${entityName})`);
}

function fillEntityChanges(entityName: string, entityPrimaryKey: string, condition = "") {
    cleanupEntityChangesForMissingEntities(entityName, entityPrimaryKey);

    const sql = getSql();
    sql.transactional(() => {
        const entityIds = sql.getColumn<string>(/*sql*/`SELECT ${entityPrimaryKey} FROM ${entityName} ${condition}`);

        let createdCount = 0;

        for (const entityId of entityIds) {
            const existingRows = sql.getValue("SELECT COUNT(1) FROM entity_changes WHERE entityName = ? AND entityId = ?", [entityName, entityId]);

            if (existingRows !== 0) {
                // we don't want to replace existing entities (which would effectively cause full resync)
                continue;
            }

            createdCount++;

            const ec: Partial<EntityChange> = {
                entityName,
                entityId,
                isErased: false
            };

            if (entityName === "blobs") {
                const blob = sql.getRow<Pick<BlobRow, "blobId" | "content" | "utcDateModified" | "textRepresentation">>("SELECT blobId, content, textRepresentation, utcDateModified FROM blobs WHERE blobId = ?", [entityId]);
                ec.hash = blobService.calculateContentHash(blob);
                ec.utcDateChanged = blob.utcDateModified;
                ec.isSynced = true; // blobs are always synced
            } else {
                const entity = becca.getEntity(entityName, entityId);

                if (entity) {
                    ec.hash = entity.generateHash();
                    ec.utcDateChanged = entity.getUtcDateChanged() || dateUtils.utcNowDateTime();
                    ec.isSynced = entityName !== "options" || !!entity.isSynced;
                } else {
                    // entity might be null (not present in becca) when it's deleted
                    // this will produce different hash value than when entity is being deleted since then
                    // all normal hashed attributes are being used. Sync should recover from that, though.
                    ec.hash = "deleted";
                    ec.utcDateChanged = dateUtils.utcNowDateTime();
                    ec.isSynced = true; // deletable (the ones with isDeleted) entities are synced
                }
            }

            putEntityChange(ec as EntityChange);
        }

        if (createdCount > 0) {
            getLog().info(`Created ${createdCount} missing entity changes for entity '${entityName}'.`);
        }
    });
}

function fillAllEntityChanges() {
    const sql = getSql();
    sql.transactional(() => {
        sql.execute("DELETE FROM entity_changes WHERE isErased = 0");

        fillEntityChanges("notes", "noteId");
        fillEntityChanges("branches", "branchId");
        fillEntityChanges("revisions", "revisionId");
        fillEntityChanges("attachments", "attachmentId");
        fillEntityChanges("blobs", "blobId");
        fillEntityChanges("attributes", "attributeId");
        fillEntityChanges("etapi_tokens", "etapiTokenId");
        fillEntityChanges("flashcards", "cardId");
        fillEntityChanges("flashcard_reviews", "reviewId");
        fillEntityChanges("options", "name", "WHERE isSynced = 1");
    });
}

function recalculateMaxEntityChangeId() {
    maxEntityChangeId = getSql().getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}

export default {
    putBlobEntityChange,
    putNoteReorderingEntityChange,
    putEntityChangeForOtherInstances,
    putEntityChangeWithForcedChange,
    putEntityChange,
    putEntityChangeWithInstanceId,
    fillAllEntityChanges,
    addEntityChangesForSector,
    getMaxEntityChangeId: () => maxEntityChangeId,
    recalculateMaxEntityChangeId
};
