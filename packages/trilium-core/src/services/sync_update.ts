import type { EntityChange, EntityChangeRecord, EntityRow } from "@triliumnext/commons";

import blobService from "./blob.js";
import entityChangesService from "./entity_changes.js";
import { getLog } from "./log.js";
import { getSql } from "./sql/index.js";
import ws from "./ws.js";
import { default as eventService } from "./events.js";
import entity_constructor from "../becca/entity_constructor.js";
import { decodeBase64, decodeBase64Into } from "./utils/binary.js";
import dateUtils from "./utils/date.js";

interface UpdateContext {
    alreadyErased: number;
    erased: number;
    updated: Record<string, string[]>;
}

function updateEntities(entityChanges: EntityChangeRecord[], instanceId: string) {
    if (entityChanges.length === 0) {
        return;
    }

    let atLeastOnePullApplied = false;
    const updateContext = {
        updated: {},
        alreadyUpdated: 0,
        erased: 0,
        alreadyErased: 0
    };

    for (const { entityChange, entity } of entityChanges) {
        const changeAppliedAlready = entityChange.changeId && !!getSql().getValue("SELECT 1 FROM entity_changes WHERE changeId = ?", [entityChange.changeId]);

        if (changeAppliedAlready) {
            updateContext.alreadyUpdated++;

            continue;
        }

        if (!atLeastOnePullApplied) {
            // avoid spamming and send only for first
            ws.syncPullInProgress();

            atLeastOnePullApplied = true;
        }

        updateEntity(entityChange, entity, instanceId, updateContext);
    }

    logUpdateContext(updateContext);
}

function updateEntity(remoteEC: EntityChange, remoteEntityRow: EntityRow | undefined, instanceId: string, updateContext: UpdateContext) {
    if (!remoteEntityRow && remoteEC.entityName === "options") {
        return; // can be undefined for options with isSynced=false
    }

    const updated = remoteEC.entityName === "note_reordering"
        ? updateNoteReordering(remoteEC, remoteEntityRow, instanceId)
        : updateNormalEntity(remoteEC, remoteEntityRow, instanceId, updateContext);

    if (updated) {
        // An erase carries no row, so becca learns of it as a deletion.
        if (remoteEC.isErased || remoteEntityRow?.isDeleted) {
            eventService.emit(eventService.ENTITY_DELETE_SYNCED, {
                entityName: remoteEC.entityName,
                entityId: remoteEC.entityId
            });
        } else {
            eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                entityName: remoteEC.entityName,
                entityRow: remoteEntityRow
            });
        }
    }
}

function updateNormalEntity(incomingEC: EntityChange, remoteEntityRow: EntityRow | undefined, instanceId: string, updateContext: UpdateContext) {
    // A change dated later than now was written while a clock ran ahead, so its real age is
    // unknown: an incoming one is stored as now, and a local one loses the conflict.
    const now = dateUtils.utcNowDateTime();
    const remoteEC = incomingEC.utcDateChanged && incomingEC.utcDateChanged > now
        ? { ...incomingEC, utcDateChanged: now }
        : incomingEC;
    const localEC = getSql().getRow<EntityChange | undefined>(/*sql*/`SELECT * FROM entity_changes WHERE entityName = ? AND entityId = ?`, [remoteEC.entityName, remoteEC.entityId]);
    const localECIsFromTheFuture = !!localEC?.utcDateChanged && localEC.utcDateChanged > now;
    const localECIsOlderOrSameAsRemote = localEC && (localECIsFromTheFuture
        || (localEC.utcDateChanged && remoteEC.utcDateChanged && localEC.utcDateChanged <= remoteEC.utcDateChanged));

    if (!localEC || localECIsOlderOrSameAsRemote) {
        if (remoteEC.isErased) {
            if (localEC?.isErased) {
                eraseEntity(remoteEC); // make sure it's erased anyway
                updateContext.alreadyErased++;
            } else {
                eraseEntity(remoteEC);
                updateContext.erased++;
            }
        } else {
            if (!remoteEntityRow) {
                throw new Error(`Empty entity row for: ${JSON.stringify(remoteEC)}`);
            }

            preProcessContent(remoteEC, remoteEntityRow);

            getSql().replace(remoteEC.entityName, remoteEntityRow);

            updateContext.updated[remoteEC.entityName] = updateContext.updated[remoteEC.entityName] || [];
            updateContext.updated[remoteEC.entityName].push(remoteEC.entityId);
        }

        if (!localEC || localECIsOlderOrSameAsRemote || localEC.hash !== remoteEC.hash || localEC.isErased !== remoteEC.isErased) {
            entityChangesService.putEntityChangeWithInstanceId(remoteEC, instanceId);
        }

        return true;
    } else if ((localEC.hash !== remoteEC.hash || localEC.isErased !== remoteEC.isErased) && !localECIsOlderOrSameAsRemote) {
        // the change on our side is newer than on the other side, so the other side should update
        entityChangesService.putEntityChangeForOtherInstances(localEC);
        requeueOwnBlobIfRemoteLacksIt(remoteEC, remoteEntityRow);

        return false;
    }

    return false;
}

const BLOB_OWNING_ENTITIES = new Set(["notes", "attachments", "revisions"]);

/**
 * Sends the local blob along with a local row that won a conflict. The remote side can have erased
 * that blob in `deleteBlobIfNotUsed()` when its own row moved to another blob, and the blob's own
 * entity change was pushed long ago, so without this the winning row arrives pointing at nothing.
 * A sync stub is never sent: its empty content would replace the full copy the remote holds.
 */
function requeueOwnBlobIfRemoteLacksIt(remoteEC: EntityChange, remoteEntityRow: EntityRow | undefined) {
    if (!BLOB_OWNING_ENTITIES.has(remoteEC.entityName)) {
        return;
    }

    const primaryKeyName = entity_constructor.getEntityFromEntityName(remoteEC.entityName).primaryKeyName;
    const localBlob = getSql().getRowOrNull<{ blobId: string; contentLength: number }>(
        /*sql*/`SELECT blobs.blobId, LENGTH(blobs.content) AS contentLength
                FROM ${remoteEC.entityName} JOIN blobs USING (blobId)
                WHERE ${remoteEC.entityName}.${primaryKeyName} = ?`,
        [remoteEC.entityId]
    );

    if (localBlob
        && localBlob.blobId !== remoteEntityRow?.blobId
        && !blobService.isSyncStub(localBlob.blobId, localBlob.contentLength)) {
        entityChangesService.putBlobEntityChange(localBlob.blobId);
    }
}

function preProcessContent(remoteEC: EntityChange, remoteEntityRow: EntityRow) {
    if (remoteEC.entityName === "blobs" && remoteEntityRow.content !== null) {
        // we always use a Buffer object which is different from normal saving - there we use a simple string type for
        // "string notes". The problem is that in general, it's not possible to detect whether a blob content
        // is string note or note (syncs can arrive out of order)
        if (typeof remoteEntityRow.content === "string") {
            remoteEntityRow.content = decodeBlobContent(remoteEntityRow.content);

            if (remoteEntityRow.content.byteLength === 0) {
                // there seems to be a bug which causes empty buffer to be stored as NULL which is then picked up as inconsistency
                // (possibly not a problem anymore with the newer better-sqlite3)
                remoteEntityRow.content = "";
            }
        }
    }
}

/**
 * Ceiling of the blob decode pool size. Covers the mobile blob cap (20 MB) with headroom;
 * blobs beyond this (only possible on uncapped platforms) fall back to a one-off allocation
 * rather than pinning an oversized pool forever.
 */
const BLOB_DECODE_POOL_MAX_BYTES = 32 * 1024 * 1024;

let blobDecodePool: Uint8Array | null = null;

/**
 * Decodes a pulled blob's base64 content, reusing one grow-only scratch buffer where the
 * platform supports in-place decode (the browser/WASM build).
 *
 * The decoded bytes only need to live until the row is INSERTed a moment later — SQLite copies
 * them synchronously — but a fresh ArrayBuffer per blob proved fatal on mobile: ArrayBuffer
 * backing stores live outside the V8 heap, so during an initial sync V8 saw no heap pressure,
 * ran major GCs too rarely, and ~200 MB of dead decoded blobs routinely sat in the WebView
 * renderer (hard-capped around ~650 MB) until it was OOM-killed. Reusing the pool removes the
 * allocation churn at the source. The returned view is only valid until the next call.
 */
function decodeBlobContent(base64: string): Uint8Array {
    // Upper bound of the decoded size: every 4 base64 chars yield at most 3 bytes.
    const maxBytes = (base64.length * 3) >> 2;

    if (maxBytes > BLOB_DECODE_POOL_MAX_BYTES) {
        return decodeBase64(base64);
    }

    if (!blobDecodePool || blobDecodePool.length < maxBytes) {
        blobDecodePool = new Uint8Array(maxBytes);
    }

    const written = decodeBase64Into(base64, blobDecodePool);
    if (written === null) {
        // No in-place decoder on this platform (native builds) — plain decode. Also keeps
        // better-sqlite3 receiving the Buffer instances it expects.
        blobDecodePool = null;
        return decodeBase64(base64);
    }

    return blobDecodePool.subarray(0, written);
}

function updateNoteReordering(remoteEC: EntityChange, remoteEntityRow: EntityRow | undefined, instanceId: string) {
    if (!remoteEntityRow) {
        throw new Error(`Empty note_reordering body for: ${JSON.stringify(remoteEC)}`);
    }

    for (const key in remoteEntityRow) {
        getSql().execute("UPDATE branches SET notePosition = ? WHERE branchId = ?", [remoteEntityRow[key as keyof EntityRow], key]);
    }

    entityChangesService.putEntityChangeWithInstanceId(remoteEC, instanceId);

    return true;
}


function eraseEntity(entityChange: EntityChange) {
    const { entityName, entityId } = entityChange;

    const entityNames = ["notes", "branches", "attributes", "revisions", "attachments", "blobs"];

    if (!entityNames.includes(entityName)) {
        getLog().error(`Cannot erase ${entityName} '${entityId}'.`);
        return;
    }

    const primaryKeyName = entity_constructor.getEntityFromEntityName(entityName).primaryKeyName;

    getSql().execute(/*sql*/`DELETE FROM ${entityName} WHERE ${primaryKeyName} = ?`, [entityId]);
}

function logUpdateContext(updateContext: UpdateContext) {
    const message = JSON.stringify(updateContext).replaceAll('"', "").replaceAll(":", ": ").replaceAll(",", ", ");

    getLog().info(message.substr(1, message.length - 2));
}

export default {
    updateEntities
};
