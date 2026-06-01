import { describe, expect, it } from "vitest";

import { getContext } from "./context.js";
import contentHash from "./content_hash.js";
import { getSql } from "./sql/index.js";
import { hash } from "./utils/index.js";

/**
 * Wraps a callback in CLS context and waits for it to complete.
 * `getEntityHashes` reads the `disableSlowQueryLogging` flag from the
 * context and calls `eraseUnusedBlobs` (a write), so a context is required.
 */
function withContext<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        getContext().init(async () => {
            try {
                resolve(await fn());
            } catch (e) {
                reject(e);
            }
        });
    });
}

let testCounter = 0;

/**
 * Inserts a synced entity_change row directly so the hash computation has
 * deterministic, isolated input. Each call gets unique IDs to avoid clashing
 * with other tests sharing the same in-memory database.
 */
function insertEntityChange(opts: {
    entityName: string;
    entityId: string;
    hash: string;
    isErased?: boolean;
    isSynced?: boolean;
}) {
    testCounter++;
    getSql().execute(
        `INSERT INTO entity_changes
            (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
         VALUES (?, ?, ?, ?, ?, 'spec', 'spec', ?, '2026-01-01 00:00:00Z')`,
        [
            opts.entityName,
            opts.entityId,
            opts.hash,
            opts.isErased ? 1 : 0,
            `cc_change_${testCounter}`,
            opts.isSynced === false ? 0 : 1
        ]
    );
}

describe("content_hash", () => {
    describe("getEntityHashes", () => {
        it("computes a per-sector hash keyed by entity name and first id char", async () => {
            const result = await withContext(() => {
                insertEntityChange({ entityName: "spec_a", entityId: "Xfoo111", hash: "AAA" });
                insertEntityChange({ entityName: "spec_a", entityId: "Xbar222", hash: "BBB" });
                return contentHash.getEntityHashes();
            });

            // Both ids share sector "X" so they combine into a single bucket.
            expect(result).toHaveProperty("spec_a");
            const sectorHashes = result["spec_a"];
            expect(Object.keys(sectorHashes)).toEqual(["X"]);

            // The bucket value is the hash of the concatenated "hash + isErased"
            // segments in entityId-sorted order (Xbar222 < Xfoo111). isErased
            // comes back from SQLite as the integer 0/1, not a JS boolean.
            const expected = hash("BBB" + 0 + "AAA" + 0);
            expect(sectorHashes["X"]).toBe(expected);
        });

        it("segments different first id chars into separate sectors", async () => {
            const result = await withContext(() => {
                insertEntityChange({ entityName: "spec_b", entityId: "1one", hash: "H1" });
                insertEntityChange({ entityName: "spec_b", entityId: "2two", hash: "H2" });
                return contentHash.getEntityHashes();
            });

            const sectorHashes = result["spec_b"];
            expect(Object.keys(sectorHashes).sort()).toEqual(["1", "2"]);
            expect(sectorHashes["1"]).toBe(hash("H1" + 0));
            expect(sectorHashes["2"]).toBe(hash("H2" + 0));
            // Different inputs must produce different hashes.
            expect(sectorHashes["1"]).not.toBe(sectorHashes["2"]);
        });

        it("incorporates the isErased flag and excludes unsynced and note_reordering rows", async () => {
            const erasedId = `Eerased${testCounter}`;
            const result = await withContext(() => {
                insertEntityChange({ entityName: "spec_c", entityId: erasedId, hash: "ER", isErased: true });
                // Not synced -> must be ignored entirely.
                insertEntityChange({ entityName: "spec_c", entityId: "EunsyncedZ", hash: "NO", isSynced: false });
                // note_reordering is explicitly excluded by the query.
                insertEntityChange({ entityName: "note_reordering", entityId: "Ereorder", hash: "RO" });
                return contentHash.getEntityHashes();
            });

            // Only the single erased, synced row contributes to sector "E";
            // the erased flag is the SQLite integer 1.
            expect(result["spec_c"]["E"]).toBe(hash("ER" + 1));
            // note_reordering never appears in the output map.
            expect(result).not.toHaveProperty("note_reordering");
        });

        it("returns the seeded demo entity types from the fixture DB", async () => {
            const result = await withContext(() => contentHash.getEntityHashes());

            // The fixture document.db is seeded with real notes/branches.
            expect(result).toHaveProperty("notes");
            expect(result).toHaveProperty("branches");
            for (const sectorHashes of Object.values(result)) {
                for (const value of Object.values(sectorHashes)) {
                    expect(typeof value).toBe("string");
                    expect(value.length).toBeGreaterThan(0);
                }
            }
        });
    });

    describe("checkContentHashes", () => {
        it("reports no failed checks when the supplied hashes match local hashes", async () => {
            const failed = await withContext(() => {
                const local = contentHash.getEntityHashes();
                return contentHash.checkContentHashes(local);
            });

            expect(failed).toEqual([]);
        });

        it("flags a sector whose remote hash differs from the local one", async () => {
            const failed = await withContext(() => {
                insertEntityChange({ entityName: "spec_d", entityId: "Mmismatch", hash: "LOCAL" });
                const local = contentHash.getEntityHashes();

                // Tamper with one sector to simulate a divergent remote.
                const tampered = JSON.parse(JSON.stringify(local));
                tampered["spec_d"]["M"] = "different-hash";

                return contentHash.checkContentHashes(tampered);
            });

            const mismatch = failed.find((c) => c.entityName === "spec_d");
            expect(mismatch).toBeDefined();
            expect(mismatch?.sector).toBe("M");
        });

        it("flags a sector present locally but missing entirely from the remote", async () => {
            const failed = await withContext(() => {
                insertEntityChange({ entityName: "spec_e", entityId: "Olocalonly", hash: "ONLY" });
                const local = contentHash.getEntityHashes();

                // Remote has no knowledge of spec_e at all.
                const remote = JSON.parse(JSON.stringify(local));
                delete remote["spec_e"];

                return contentHash.checkContentHashes(remote);
            });

            const mismatch = failed.find((c) => c.entityName === "spec_e");
            expect(mismatch).toBeDefined();
            expect(mismatch?.sector).toBe("O");
        });
    });
});
