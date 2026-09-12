import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(() => -1),
    /** Reads the `revisionIgnoreNamedSnapshots` option, which the named-revisions field follows. */
    is: vi.fn<(name: string) => boolean>(() => true),
    /** Whoever is listening to the websocket, which for the length of a run is the run itself. */
    listeners: [] as ((message: unknown) => void)[],
    /** What the server reports over that socket while a compression request is still open. */
    progress: [] as { progressCount: number; totalCount?: number }[],
    post: vi.fn(async (url: string, body?: object) => {
        if (url === "database/vacuum-database") return { sizeBefore: 9000, sizeAfter: 2000 };
        // A saving far larger than any reading here, so a test can prove it is never added on top:
        // the compression step runs between the two readings and is already counted in them.
        if (url === "notes/root/compress-images") {
            const { taskId } = (body ?? {}) as { taskId?: string };

            mocks.progress.forEach((report) => mocks.listeners.forEach(
                (listener) => listener({ type: "taskProgressCount", taskId, ...report })));

            return { savedSize: 999999 };
        }
        return undefined;
    }),
    /** Occupied bytes, read once before the erasures and once after; shifted per test. */
    occupied: [ 5000, 3000 ],
    get: vi.fn()
}));

vi.mock("../../../services/options", () => ({ default: { getInt: mocks.getInt, is: mocks.is } }));
// The run reaches for the long-timeout variants throughout: every request it makes is a
// whole-database operation. The timeout itself is dropped here, leaving (url, data) as the calls
// under test.
vi.mock("../../../services/server", () => ({
    default: {
        // The whole-database operations reach for the long-timeout variants; recording the outcome
        // is an ordinary write and keeps the default. Both funnel here, so the assertions below read
        // the run's calls in order regardless of which variant made them.
        post: mocks.post,
        postWithTimeout: (url: string, _timeoutMs: number, data?: object) => mocks.post(url, data),
        getWithTimeout: (url: string) => {
            mocks.get(url);
            const size = mocks.occupied.shift() ?? 0;
            return Promise.resolve({ content: { size }, deletedNotes: { size: 0 } });
        }
    }
}));

// The compression step is followed over the websocket rather than answered by the request, so the
// socket is where its counting has to be driven from.
vi.mock("../../../services/ws", () => ({
    subscribeToMessages: (listener: (message: unknown) => void) => void mocks.listeners.push(listener),
    unsubscribeToMessage: (listener: (message: unknown) => void) =>
        void mocks.listeners.splice(mocks.listeners.indexOf(listener), 1)
}));

import type { ImageCompressionToolOptions } from "../../dialogs/image_compression/image_compression_options";
import {
    type CleanupPhase,
    type CleanupProgress,
    type CleanupToolOptions,
    computeCleanupSizes,
    hasWorkToDo,
    readCleanupOptions,
    runCleanup,
    storedCleanupOptions
} from "./cleanup_operation";

/** Only the fields the sizes are read from; the rest of the response is beside the point here. */
function usage(revisions: number, deleted = 0, unused = 0) {
    return {
        subtreeRevisionsContentSize: revisions,
        deletedNotes: { size: deleted, noteCount: 0, attachmentCount: 0 },
        unusedAttachments: { size: unused, attachmentCount: 0 }
    } as SpaceUsageNoteResponse;
}

/**
 * What the compression rows open on here: scaling alone, both formats left exactly as encoded.
 * Deliberately not the image dialog's own defaults — this runs over every image there is.
 */
const CONSERVATIVE_COMPRESSION: ImageCompressionToolOptions = {
    resize: true,
    maxWidthHeight: 1920,
    jpegHandling: "keep",
    pngHandling: "keep",
    quality: 75,
    conversionQuality: 85,
    processChildNotes: false
};

const ALL_PICKED: CleanupToolOptions = {
    deletedEntities: true,
    unusedAttachments: true,
    revisionSnapshots: true,
    snapshotsToKeep: 3,
    keepNamedSnapshots: true,
    compressImages: false,
    imageCompression: CONSERVATIVE_COMPRESSION,
    compactDatabase: false
};

/** Recompressing on its own, so the phases a run reports are that step's and nothing else's. */
const ONLY_COMPRESSING: CleanupToolOptions = {
    ...ALL_PICKED,
    deletedEntities: false,
    unusedAttachments: false,
    revisionSnapshots: false,
    compressImages: true
};

beforeEach(() => {
    mocks.getInt.mockReturnValue(-1);
    mocks.is.mockReturnValue(true);
    mocks.occupied = [ 5000, 3000 ];
    mocks.listeners.length = 0;
    mocks.progress.length = 0;
    mocks.post.mockClear();
    mocks.get.mockClear();
});

describe("readCleanupOptions", () => {
    it("picks nothing at all when the setting has never been written", () => {
        mocks.is.mockReturnValue(false);

        // The only safe reading of an absent answer, for an operation that deletes without recourse.
        for (const stored of [ undefined, null, {} ]) {
            expect(readCleanupOptions(stored)).toEqual({
                deletedEntities: false,
                unusedAttachments: false,
                revisionSnapshots: false,
                snapshotsToKeep: 4,
                keepNamedSnapshots: false,
                compressImages: false,
                imageCompression: CONSERVATIVE_COMPRESSION,
                compactDatabase: false
            });
        }
    });

    it("opens compression on scaling alone, not on the image tool's own defaults", () => {
        // The dialog's defaults re-encode both formats, which is a far larger bet made across every
        // image in the database than across the one note the user was looking at.
        const { imageCompression } = readCleanupOptions({});
        expect(imageCompression).toMatchObject({
            resize: true, maxWidthHeight: 1920, jpegHandling: "keep", pngHandling: "keep"
        });

        // Answered here, the answer stands — including one that turns scaling off entirely.
        expect(readCleanupOptions({ imageCompression: { ...CONSERVATIVE_COMPRESSION, resize: false, pngHandling: "jpeg" } })
            .imageCompression).toMatchObject({ resize: false, pngHandling: "jpeg" });
    });

    it("follows the note revision setting on named revisions until it is answered here", () => {
        expect(readCleanupOptions({}).keepNamedSnapshots).toBe(true);

        // Once answered, the stored answer stands — including the one that matches no setting.
        expect(readCleanupOptions({ keepNamedSnapshots: false }).keepNamedSnapshots).toBe(false);

        mocks.is.mockReturnValue(false);
        expect(readCleanupOptions({}).keepNamedSnapshots).toBe(false);
        expect(readCleanupOptions({ keepNamedSnapshots: true }).keepNamedSnapshots).toBe(true);
    });

    it("never opens on compacting, however the last run left it", () => {
        // The most expensive step by far, and not one to run because a tick was left behind.
        expect(readCleanupOptions({ compactDatabase: true }).compactDatabase).toBe(false);
    });

    it("opens on the configured revision limit, where that limit trims anything", () => {
        mocks.getInt.mockReturnValue(7);
        expect(readCleanupOptions({}).snapshotsToKeep).toBe(7);

        // -1 keeps everything and 0 keeps none: neither is an opening offer for a one-off trim.
        for (const configured of [ -1, 0 ]) {
            mocks.getInt.mockReturnValue(configured);
            expect(readCleanupOptions({}).snapshotsToKeep).toBe(4);
        }
    });

    it("reads a stored answer back as it was left, zero retention included", () => {
        expect(readCleanupOptions({ revisionSnapshots: true, snapshotsToKeep: 0, keepNamedSnapshots: true }))
            .toEqual({
                deletedEntities: false,
                unusedAttachments: false,
                revisionSnapshots: true,
                snapshotsToKeep: 0,
                keepNamedSnapshots: true,
                compressImages: false,
                imageCompression: CONSERVATIVE_COMPRESSION,
                compactDatabase: false
            });

        // A retention that could not have been written by the dialog falls back rather than through.
        expect(readCleanupOptions({ snapshotsToKeep: -5 }).snapshotsToKeep).toBe(4);
    });
});

describe("storedCleanupOptions", () => {
    it("remembers every answer but the compacting step, compression settings included", () => {
        expect(storedCleanupOptions({ ...ALL_PICKED, compressImages: true, compactDatabase: true })).toEqual({
            deletedEntities: true,
            unusedAttachments: true,
            revisionSnapshots: true,
            snapshotsToKeep: 3,
            keepNamedSnapshots: true,
            compressImages: true,
            imageCompression: CONSERVATIVE_COMPRESSION
        });
    });
});

describe("hasWorkToDo", () => {
    const nothingPicked = { ...ALL_PICKED, deletedEntities: false, unusedAttachments: false, revisionSnapshots: false };

    it("counts compressing on its own, which no estimate can speak for", () => {
        // Nothing selected weighs anything, and compressing is not in the estimate at all — so
        // without this the button would be disabled for a run that has plenty to do.
        expect(hasWorkToDo(nothingPicked, 0)).toBe(false);
        expect(hasWorkToDo({ ...nothingPicked, compressImages: true }, 0)).toBe(true);
        expect(hasWorkToDo({ ...nothingPicked, compactDatabase: true }, 0)).toBe(true);
        expect(hasWorkToDo(nothingPicked, 500)).toBe(true);
    });
});

describe("computeCleanupSizes", () => {
    it("weighs the whole at the most aggressive trim, and the offer at the chosen one", () => {
        const sizes = computeCleanupSizes(usage(900, 100, 20), usage(300), ALL_PICKED);

        // Keeping snapshots can only take away from what erasing the history outright would free,
        // so the whole stays put while the item's own figure follows the settings.
        expect(sizes.total).toBe(900 + 100 + 20);
        expect(sizes.compaction).toBe(0);
        expect(sizes.perItem).toEqual({ deletedEntities: 100, unusedAttachments: 20, revisionSnapshots: 300 });
        expect(sizes.selected).toBe(300 + 100 + 20);
    });

    it("adds what a rebuild would return, which no content figure describes", () => {
        const withCompaction = computeCleanupSizes(usage(900, 100, 20), usage(300), ALL_PICKED, 500);

        // Free pages are what erasing already finished with; the figures above weigh content still
        // to be erased. Neither ever describes the same byte, so the whole is their sum.
        expect(withCompaction.compaction).toBe(500);
        expect(withCompaction.total).toBe(900 + 100 + 20 + 500);
        // Not on offer until compacting is picked, though.
        expect(withCompaction.selected).toBe(300 + 100 + 20);
        expect(computeCleanupSizes(usage(900, 100, 20), usage(300),
            { ...ALL_PICKED, compactDatabase: true }, 500).selected).toBe(300 + 100 + 20 + 500);
    });

    it("counts only what is picked, and nothing at all before the measurements arrive", () => {
        const sizes = computeCleanupSizes(usage(900, 100, 20), usage(300),
            { ...ALL_PICKED, deletedEntities: false, revisionSnapshots: false });
        expect(sizes.selected).toBe(20);

        const unmeasured = computeCleanupSizes(null, null, ALL_PICKED);
        expect(unmeasured.total).toBe(0);
        expect(unmeasured.selected).toBe(0);
    });
});

describe("runCleanup", () => {
    it("erases what is picked, sweeping the orphaned blobs last", async () => {
        await runCleanup(ALL_PICKED);

        // Erasing revisions or attachments leaves the blobs they held; only the deleted-entity sweep
        // purges those, so it has to run after the two that create the orphans. The outcome is
        // recorded last of all, once there is a measured figure to record.
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now",
            "space-usage/cleanup-completed"
        ]);
        expect(mocks.post.mock.calls[0][1]).toEqual({ snapshotsToKeep: 3, keepNamedSnapshots: true });
    });

    it("recompresses the whole tree after the erasures, and only when asked", async () => {
        await runCleanup(ALL_PICKED);
        expect(mocks.post.mock.calls.map(([ url ]) => url)).not.toContain("notes/root/compress-images");

        mocks.post.mockClear();
        await runCleanup({
            ...ALL_PICKED,
            compressImages: true,
            imageCompression: { ...CONSERVATIVE_COMPRESSION, jpegHandling: "compress", quality: 60 }
        });

        // After the erasures: an original a revision still points at survives being replaced, so
        // erasing the snapshots first is what lets the originals go with them.
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now",
            "notes/root/compress-images",
            "space-usage/cleanup-completed"
        ]);
        // The whole tree, and none of the tool's own scope switch — a cleanup has no scope to choose.
        expect(mocks.post.mock.calls[3][1]).toEqual({
            // Named, which is the whole of what it takes to be counted: the server reports each
            // image against a task, and there is a task only because the request quoted one.
            taskId: expect.any(String),
            resize: true,
            maxWidthHeight: 1920,
            jpegHandling: "compress",
            pngHandling: "keep",
            quality: 60,
            conversionQuality: 85,
            recursive: true
        });
    });

    it("counts the images off as the run reports them, against a total it supplies itself", async () => {
        const reported: [ CleanupPhase, CleanupProgress | undefined ][] = [];

        mocks.progress = [ { progressCount: 1, totalCount: 867 }, { progressCount: 197, totalCount: 867 } ];

        await runCleanup({ ...ONLY_COMPRESSING }, (phase, progress) => reported.push([ phase, progress ]));

        // The phase announces itself before the request is made — nothing can be counted yet — and
        // is then re-announced with each report. No inventory is read for the total: the run knows
        // how many images it collected before it touches the first, and says so as it goes.
        expect(reported).toEqual([
            [ "compressing", undefined ],
            [ "compressing", { done: 1, total: 867 } ],
            [ "compressing", { done: 197, total: 867 } ]
        ]);
    });

    it("hears only its own run, and stops listening once that run is over", async () => {
        const reported: CleanupProgress[] = [];

        mocks.progress = [ { progressCount: 5, totalCount: 40 } ];

        await runCleanup({ ...ONLY_COMPRESSING }, (_phase, progress) => {
            if (progress) {
                reported.push(progress);
            }
        });

        expect(reported).toEqual([ { done: 5, total: 40 } ]);
        // Subscribed for the length of the request rather than the length of the session: a second
        // run's reports must not still be counted against a toast this one has taken down.
        expect(mocks.listeners).toEqual([]);
    });

    it("counts what compressing freed once, through the readings rather than the endpoint", async () => {
        mocks.occupied = [ 5000, 1200 ];

        // The endpoint answers with a saving of its own; the run must report the 3800 the database
        // actually gave back rather than that figure, or the sum of the two.
        await expect(runCleanup({ ...ALL_PICKED, deletedEntities: false, unusedAttachments: false,
            revisionSnapshots: false, compressImages: true })).resolves.toBe(3800);
    });

    it("reports what the database actually gave back, not what was predicted", async () => {
        mocks.occupied = [ 5000, 1200 ];

        // Weighed on either side of the erasures — the whole point of the two extra readings.
        await expect(runCleanup(ALL_PICKED)).resolves.toBe(3800);
        expect(mocks.get.mock.calls.map(([ url ]) => url))
            .toEqual([ "space-usage/overview?limit=1", "space-usage/overview?limit=1" ]);
        expect(mocks.post).toHaveBeenCalledWith("space-usage/cleanup-completed", { reclaimedBytes: 3800 });
    });

    it("never reports a gain when the database grew under it", async () => {
        // Another client saving a note mid-run must not read as the cleanup handing space back.
        mocks.occupied = [ 3000, 4000 ];
        await expect(runCleanup(ALL_PICKED)).resolves.toBe(0);
    });

    it("rebuilds the file last, and reports the file's own before and after", async () => {
        // The rebuild returns 9000 → 2000; the content readings would have said 2000. The file is
        // the truer figure and subsumes the erasures, whose pages the rebuild is what hands back.
        await expect(runCleanup({ ...ALL_PICKED, compactDatabase: true })).resolves.toBe(7000);

        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now",
            "database/vacuum-database",
            "space-usage/cleanup-completed"
        ]);
        expect(mocks.post).toHaveBeenCalledWith("space-usage/cleanup-completed", { reclaimedBytes: 7000 });
        // And the content weighings are skipped entirely, being two readings of the whole database
        // for a figure that is not going to be used.
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it("compacts on its own, for a run that erases nothing at all", async () => {
        mocks.occupied = [ 5000, 5000 ];
        const nothingErased = {
            ...ALL_PICKED,
            deletedEntities: false,
            unusedAttachments: false,
            revisionSnapshots: false,
            compactDatabase: true
        };

        await runCleanup(nothingErased);

        expect(mocks.post.mock.calls.map(([ url ]) => url))
            .toEqual([ "database/vacuum-database", "space-usage/cleanup-completed" ]);
    });

    it("reports the phase it is in, naming the rebuild separately from the erasures", async () => {
        const phases = vi.fn();
        await runCleanup({ ...ALL_PICKED, compactDatabase: true }, phases);
        expect(phases.mock.calls.flat()).toEqual([ "erasing", "compacting" ]);

        // Only what actually happens is announced: a run that erases nothing never claims to.
        phases.mockClear();
        mocks.occupied = [ 5000, 5000 ];
        await runCleanup({
            ...ALL_PICKED,
            deletedEntities: false,
            unusedAttachments: false,
            revisionSnapshots: false,
            compactDatabase: true
        }, phases);
        expect(phases.mock.calls.flat()).toEqual([ "compacting" ]);

        phases.mockClear();
        mocks.occupied = [ 5000, 4000 ];
        await runCleanup(ALL_PICKED, phases);
        expect(phases.mock.calls.flat()).toEqual([ "erasing" ]);
    });

    it("asks for nothing that was not picked", async () => {
        await runCleanup({ ...ALL_PICKED, revisionSnapshots: false, deletedEntities: false });
        expect(mocks.post.mock.calls.map(([ url ]) => url))
            .toEqual([ "notes/erase-unused-attachments-now", "space-usage/cleanup-completed" ]);

        mocks.post.mockClear();
        mocks.occupied = [ 5000, 5000 ];
        await runCleanup({ ...ALL_PICKED, deletedEntities: false, unusedAttachments: false, revisionSnapshots: false });
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([ "space-usage/cleanup-completed" ]);
    });
});
