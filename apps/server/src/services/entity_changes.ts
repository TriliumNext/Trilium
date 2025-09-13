import sql from "./sql.js";
import dateUtils from "./date_utils.js";
import log from "./log.js";
import cls from "./cls.js";
import { randomString } from "./utils.js";
import instanceId from "./instance_id.js";
import becca from "../becca/becca.js";
import blobService from "../services/blob.js";
import type { EntityChange } from "./entity_changes_interface.js";
import type { Blob } from "./blob-interface.js";
import eventService from "./events.js";

let maxEntityChangeId = 0;

function putEntityChangeWithInstanceId(origEntityChange: EntityChange, instanceId: string) {
    const ec = { ...origEntityChange, instanceId };

    putEntityChange(ec);
}

function putEntityChangeWithForcedChange(origEntityChange: EntityChange) {
    const ec = { ...origEntityChange, changeId: null };

    putEntityChange(ec);
}

function putEntityChange(origEntityChange: EntityChange) {
    const ec = { ...origEntityChange };

    delete ec.id;

    if (!ec.changeId) {
        ec.changeId = randomString(12);
    }

    ec.componentId = ec.componentId || cls.getComponentId() || "NA"; // NA = not available
    ec.instanceId = ec.instanceId || instanceId;
    ec.isSynced = ec.isSynced ? 1 : 0;
    ec.isErased = ec.isErased ? 1 : 0;
    ec.id = sql.replace("entity_changes", ec);

    if (ec.id) {
        maxEntityChangeId = Math.max(maxEntityChangeId, ec.id);
    }

    cls.putEntityChange(ec);
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
        instanceId
    });

    eventService.emit(eventService.ENTITY_CHANGED, {
        entityName: "note_reordering",
        entity: sql.getMap(/*sql*/`SELECT branchId, notePosition FROM branches WHERE isDeleted = 0 AND parentNoteId = ?`, [parentNoteId])
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
    const entityChanges = sql.getRows<EntityChange>(/*sql*/`SELECT * FROM entity_changes WHERE entityName = ? AND SUBSTR(entityId, 1, 1) = ?`, [entityName, sector]);

    let entitiesInserted = entityChanges.length;

    sql.transactional(() => {
        if (entityName === "blobs") {
            entitiesInserted += addEntityChangesForDependingEntity(sector, "notes", "noteId");
            entitiesInserted += addEntityChangesForDependingEntity(sector, "attachments", "attachmentId");
            entitiesInserted += addEntityChangesForDependingEntity(sector, "revisions", "revisionId");
        }

        for (const ec of entityChanges) {
            putEntityChangeWithForcedChange(ec);
        }
    });

    log.info(`Added sector ${sector} of '${entityName}' (${entitiesInserted} entities) to the sync queue.`);
}

function addEntityChangesForDependingEntity(sector: string, tableName: string, primaryKeyColumn: string) {
    // problem in blobs might be caused by problem in entity referencing the blob
    const dependingEntityChanges = sql.getRows<EntityChange>(
        `
                SELECT dep_change.*
                FROM entity_changes orig_sector
                JOIN ${tableName} ON ${tableName}.blobId = orig_sector.entityId
                JOIN entity_changes dep_change ON dep_change.entityName = '${tableName}' AND dep_change.entityId = ${tableName}.${primaryKeyColumn}
                WHERE orig_sector.entityName = 'blobs' AND SUBSTR(orig_sector.entityId, 1, 1) = ?`,
        [sector]
    );

    for (const ec of dependingEntityChanges) {
        putEntityChangeWithForcedChange(ec);
    }

    return dependingEntityChanges.length;
}

function cleanupEntityChangesForMissingEntities(entityName: string, entityPrimaryKey: string) {
    sql.execute(`
    DELETE
    FROM entity_changes
    WHERE
        isErased = 0
        AND entityName = '${entityName}'
        AND entityId NOT IN (SELECT ${entityPrimaryKey} FROM ${entityName})`);
}

function fillEntityChanges(entityName: string, entityPrimaryKey: string, condition = "") {
    cleanupEntityChangesForMissingEntities(entityName, entityPrimaryKey);

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
                const blob = sql.getRow<Blob>("SELECT blobId, content, contentLocation, contentLength, utcDateModified FROM blobs WHERE blobId = ?", [entityId]);
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
            log.info(`Created ${createdCount} missing entity changes for entity '${entityName}'.`);
        }
    });
}

function fillAllEntityChanges() {
    sql.transactional(() => {
        sql.execute("DELETE FROM entity_changes WHERE isErased = 0");

        fillEntityChanges("notes", "noteId");
        fillEntityChanges("branches", "branchId");
        fillEntityChanges("revisions", "revisionId");
        fillEntityChanges("attachments", "attachmentId");
        fillEntityChanges("blobs", "blobId");
        fillEntityChanges("attributes", "attributeId");
        fillEntityChanges("etapi_tokens", "etapiTokenId");
        fillEntityChanges("options", "name", "WHERE isSynced = 1");
    });
}

function recalculateMaxEntityChangeId() {
    maxEntityChangeId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}

export default {
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
