const sql = require('./sql');
const dateUtils = require('./date_utils');
const log = require('./log');
const cls = require('./cls');
const utils = require('./utils');
const instanceId = require('./instance_id');
const becca = require("../becca/becca");
const blobService = require("../services/blob");

let maxEntityChangeId = 0;

function putEntityChangeWithInstanceId(origEntityChange, instanceId) {
    const ec = {...origEntityChange, instanceId};

    putEntityChange(ec);
}

function putEntityChange(origEntityChange) {
    const ec = {...origEntityChange};

    delete ec.id;

    if (!ec.changeId) {
        ec.changeId = utils.randomString(12);
    }

    ec.componentId = ec.componentId || cls.getComponentId() || "NA"; // NA = not available
    ec.instanceId = ec.instanceId || instanceId;
    ec.isSynced = ec.isSynced ? 1 : 0;
    ec.isErased = ec.isErased ? 1 : 0;
    ec.id = sql.replace("entity_changes", ec);

    maxEntityChangeId = Math.max(maxEntityChangeId, ec.id);

    cls.putEntityChange(ec);
}

function putNoteReorderingEntityChange(parentNoteId, componentId) {
    putEntityChange({
        entityName: "note_reordering",
        entityId: parentNoteId,
        hash: 'N/A',
        isErased: false,
        utcDateChanged: dateUtils.utcNowDateTime(),
        isSynced: true,
        componentId,
        instanceId
    });

    const eventService = require('./events');

    eventService.emit(eventService.ENTITY_CHANGED, {
        entityName: 'note_reordering',
        entity: sql.getMap(`SELECT branchId, notePosition FROM branches WHERE isDeleted = 0 AND parentNoteId = ?`, [parentNoteId])
    });
}

function putEntityChangeForOtherInstances(ec) {
    putEntityChange({
        ...ec,
        changeId: null,
        instanceId: null
    });
}

function addEntityChangesForSector(entityName, sector) {
    const entityChanges = sql.getRows(`SELECT * FROM entity_changes WHERE entityName = ? AND SUBSTR(entityId, 1, 1) = ?`, [entityName, sector]);

    sql.transactional(() => {
        for (const ec of entityChanges) {
            putEntityChange(ec);
        }
    });

    log.info(`Added sector ${sector} of '${entityName}' (${entityChanges.length} entities) to the sync queue.`);
}

function cleanupEntityChangesForMissingEntities(entityName, entityPrimaryKey) {
    sql.execute(`
      DELETE 
      FROM entity_changes 
      WHERE
        isErased = 0
        AND entityName = '${entityName}' 
        AND entityId NOT IN (SELECT ${entityPrimaryKey} FROM ${entityName})`);
}

function fillEntityChanges(entityName, entityPrimaryKey, condition = '') {
    cleanupEntityChangesForMissingEntities(entityName, entityPrimaryKey);

    sql.transactional(() => {
        const entityIds = sql.getColumn(`SELECT ${entityPrimaryKey} FROM ${entityName} ${condition}`);

        let createdCount = 0;

        for (const entityId of entityIds) {
            const existingRows = sql.getValue("SELECT COUNT(1) FROM entity_changes WHERE entityName = ? AND entityId = ?", [entityName, entityId]);

            if (existingRows !== 0) {
                // we don't want to replace existing entities (which would effectively cause full resync)
                continue;
            }

            createdCount++;

            const ec = {
                entityName,
                entityId,
                isErased: false
            };

            if (entityName === 'blobs') {
                const blob = sql.getRow("SELECT blobId, content, utcDateModified FROM blobs WHERE blobId = ?", [entityId]);
                ec.hash = blobService.calculateContentHash(blob);
                ec.utcDateChanged = blob.utcDateModified;
                ec.isSynced = true; // blobs are always synced
            } else {
                const entity = becca.getEntity(entityName, entityId);

                if (entity) {
                    ec.hash = entity.generateHash() || "|deleted";
                    ec.utcDateChanged = entity.getUtcDateChanged() || dateUtils.utcNowDateTime();
                    ec.isSynced = entityName !== 'options' || !!entity.isSynced;
                } else {
                    // entity might be null (not present in becca) when it's deleted
                    // FIXME: hacky, not sure if it might cause some problems
                    ec.hash = "deleted";
                    ec.utcDateChanged = dateUtils.utcNowDateTime();
                    ec.isSynced = true; // deletable (the ones with isDeleted) entities are synced
                }
            }

            putEntityChange(ec);
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
        fillEntityChanges("options", "name", 'WHERE isSynced = 1');
    });
}

function recalculateMaxEntityChangeId() {
    maxEntityChangeId = sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}

module.exports = {
    putNoteReorderingEntityChange,
    putEntityChangeForOtherInstances,
    putEntityChange,
    putEntityChangeWithInstanceId,
    fillAllEntityChanges,
    addEntityChangesForSector,
    getMaxEntityChangeId: () => maxEntityChangeId,
    recalculateMaxEntityChangeId
};
