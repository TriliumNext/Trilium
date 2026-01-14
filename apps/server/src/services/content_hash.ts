import { erase as eraseService,utils } from "@triliumnext/core";

import log from "./log.js";
import sql from "./sql.js";

type SectorHash = Record<string, string>;

interface FailedCheck {
    entityName: string;
    sector: string[1];
}

function getEntityHashes() {
    // blob erasure is not synced, we should check before each sync if there's some blob to erase
    eraseService.eraseUnusedBlobs();

    const startTime = new Date();

    // we know this is slow and the total content hash calculation time is logged
    type HashRow = [string, string, string, boolean];
    const hashRows = sql.disableSlowQueryLogging(() =>
        sql.getRawRows<HashRow>(`
            SELECT entityName,
                    entityId,
                    hash,
                    isErased
            FROM entity_changes
            WHERE isSynced = 1
            AND entityName != 'note_reordering'`)
    );

    // sorting is faster in memory
    // sorting by entityId is enough, hashes will be segmented by entityName later on anyway
    hashRows.sort((a, b) => (a[1] < b[1] ? -1 : 1));

    const hashMap: Record<string, SectorHash> = {};

    for (const [entityName, entityId, hash, isErased] of hashRows) {
        const entityHashMap = (hashMap[entityName] = hashMap[entityName] || {});

        const sector = entityId[0];

        // if the entity is erased, its hash is not updated, so it has to be added extra
        entityHashMap[sector] = (entityHashMap[sector] || "") + hash + isErased;
    }

    for (const entityHashMap of Object.values(hashMap)) {
        for (const key in entityHashMap) {
            entityHashMap[key] = utils.hash(entityHashMap[key]);
        }
    }

    const elapsedTimeMs = Date.now() - startTime.getTime();

    log.info(`Content hash computation took ${elapsedTimeMs}ms`);

    return hashMap;
}

function checkContentHashes(otherHashes: Record<string, SectorHash>) {
    const entityHashes = getEntityHashes();
    const failedChecks: FailedCheck[] = [];

    for (const entityName in entityHashes) {
        const thisSectorHashes: SectorHash = entityHashes[entityName] || {};
        const otherSectorHashes: SectorHash = otherHashes[entityName] || {};

        const sectors = new Set(Object.keys(thisSectorHashes).concat(Object.keys(otherSectorHashes)));

        for (const sector of sectors) {
            if (thisSectorHashes[sector] !== otherSectorHashes[sector]) {
                log.info(`Content hash check for ${entityName} sector ${sector} FAILED. Local is ${thisSectorHashes[sector]}, remote is ${otherSectorHashes[sector]}`);

                failedChecks.push({ entityName, sector });
            }
        }
    }

    if (failedChecks.length === 0) {
        log.info("Content hash checks PASSED");
    }

    return failedChecks;
}

export default {
    getEntityHashes,
    checkContentHashes
};
