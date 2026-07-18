import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";

import SyncInstance from "./sync-instance";

/**
 * End-to-end test of the sync protocol between two real server instances (production bundle,
 * real HTTP, real HMAC login/paging/batching): a seeded source, a fresh target doing a full
 * initial sync, then incremental sync in both directions, and finally an offline comparison
 * of the two databases.
 *
 * The fixture is seeded through ETAPI (the real write path) and is deliberately sized so the
 * pull crosses the server's 1000-row fetch batches many times and includes one record larger
 * than the response byte cap — the two regressions most likely to be reintroduced by future
 * sync work.
 */

const PASSWORD = "sync-e2e-password";

test.describe("sync protocol", () => {
    // This spec spawns its own local server instances from the production bundle, so it only
    // needs `dist/main.cjs` to exist — which every CI e2e job guarantees (they all build the
    // server first), regardless of whether the *main* e2e target is local or Docker-hosted.
    test.skip(
        !existsSync(join(__dirname, "..", "..", "dist", "main.cjs")),
        "requires the built server bundle (dist/main.cjs)"
    );

    test("initial sync reproduces the source; incremental sync works both ways", async ({}, testInfo) => {
        test.setTimeout(600_000);

        const basePort = 8300 + testInfo.workerIndex * 2;
        const source = new SyncInstance(testInfo.outputPath("source-data"), basePort);
        const target = new SyncInstance(testInfo.outputPath("target-data"), basePort + 1);

        try {
            let fixture = { totalNotes: 0 };

            await test.step("seed the source instance", async () => {
                await source.start();
                await source.initNewDocument();
                await source.setPassword(PASSWORD);
                await source.etapiLogin(PASSWORD);
                fixture = await source.seedFixture();
            });

            await test.step("initial sync into a fresh target", async () => {
                await target.start();
                await target.setupSyncFromServer(source.baseUrl, PASSWORD);
                await target.waitForInitialSyncDone();
            });

            await test.step("target reproduces the seeded content", async () => {
                // the password (and ETAPI credentials) are themselves synced options
                await target.etapiLogin(PASSWORD);

                for (const title of ["sync-fixture note 0-0", "sync-fixture note 7-31", "sync-fixture parent 3"]) {
                    const sourceNoteId = await source.findNoteByTitle(title);
                    const targetNoteId = await target.findNoteByTitle(title);
                    expect(targetNoteId, `note "${title}" should exist on the target`).not.toBeNull();
                    expect(targetNoteId).toBe(sourceNoteId);

                    if (sourceNoteId && targetNoteId) {
                        expect(await target.getNoteContent(targetNoteId)).toBe(await source.getNoteContent(sourceNoteId));
                    }
                }

                // the large note crosses the pull response byte cap as a single record
                const largeId = await target.findNoteByTitle("sync-fixture large note");
                expect(largeId).not.toBeNull();
                if (largeId) {
                    const sourceId = await source.findNoteByTitle("sync-fixture large note");
                    expect(sourceId).not.toBeNull();
                    if (sourceId) {
                        const [targetContent, sourceContent] = [await target.getNoteContent(largeId), await source.getNoteContent(sourceId)];
                        expect(targetContent.length).toBe(sourceContent.length);
                        expect(targetContent).toBe(sourceContent);
                    }
                }
            });

            await test.step("incremental sync: source -> target", async () => {
                await source.createNote({ title: "sync-incremental from source", content: "<p>made on source</p>" });

                // a restart deterministically triggers the target's sync cycle
                await target.restart();

                await expect
                    .poll(async () => await target.findNoteByTitle("sync-incremental from source"), { timeout: 120_000 })
                    .not.toBeNull();
            });

            await test.step("incremental sync: target -> source (push)", async () => {
                await target.createNote({ title: "sync-incremental from target", content: "<p>made on target</p>" });

                // the target's sync cycle pushes local changes before pulling
                await target.restart();

                await expect
                    .poll(async () => await source.findNoteByTitle("sync-incremental from target"), { timeout: 120_000 })
                    .not.toBeNull();
            });

            await test.step("offline database comparison", async () => {
                await source.stop();
                await target.stop();

                const counts = (dataDir: string) => {
                    const db = new Database(join(dataDir, "document.db"), { readonly: true });
                    try {
                        return {
                            notes: db.prepare("SELECT COUNT(*) c FROM notes WHERE isDeleted = 0").get() as { c: number },
                            branches: db.prepare("SELECT COUNT(*) c FROM branches WHERE isDeleted = 0").get() as { c: number },
                            attributes: db.prepare("SELECT COUNT(*) c FROM attributes WHERE isDeleted = 0").get() as { c: number },
                            // CAST to BLOB so LENGTH() counts bytes on both sides: locally-saved text
                            // notes are stored as TEXT (LENGTH = characters) while synced content is
                            // stored as a Buffer (LENGTH = bytes) — same bytes, different column type.
                            blobs: db.prepare("SELECT COUNT(*) c, COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) bytes FROM blobs").get() as { c: number; bytes: number }
                        };
                    } finally {
                        db.close();
                    }
                };

                const sourceCounts = counts(source.dataDir);
                const targetCounts = counts(target.dataDir);

                expect(targetCounts.notes.c).toBe(sourceCounts.notes.c);
                expect(targetCounts.branches.c).toBe(sourceCounts.branches.c);
                expect(targetCounts.attributes.c).toBe(sourceCounts.attributes.c);
                expect(targetCounts.blobs.c).toBe(sourceCounts.blobs.c);
                expect(targetCounts.blobs.bytes).toBe(sourceCounts.blobs.bytes);

                // sanity: the fixture actually made it in (not comparing two empty databases)
                expect(sourceCounts.notes.c).toBeGreaterThan(fixture.totalNotes);
            });
        } finally {
            await source.stop();
            await target.stop();
        }
    });
});
