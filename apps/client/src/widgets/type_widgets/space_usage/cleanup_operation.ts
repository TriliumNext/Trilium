import type {
    CompactionEstimateResponse,
    SpaceUsageNoteResponse,
    SpaceUsageOverviewResponse,
    VacuumDatabaseResponse
} from "@triliumnext/commons";

import optionService from "../../../services/options";
import server from "../../../services/server";
import { newCompressionTaskId, runImageCompression } from "../../dialogs/image_compression/image_compression_operation";
import {
    CONSERVATIVE_IMAGE_COMPRESSION_DEFAULTS,
    type ImageCompressionToolOptions,
    readImageCompressionOptions
} from "../../dialogs/image_compression/image_compression_options";

/** The cleanup's items, in the order they are both listed and drawn. */
export const CLEANUP_ITEMS = [
    { id: "deletedEntities", labelKey: "space_usage.cleanup_deleted_entities" },
    { id: "unusedAttachments", labelKey: "space_usage.cleanup_unused_attachments" },
    { id: "revisionSnapshots", labelKey: "space_usage.cleanup_revision_snapshots" }
] as const;

export type CleanupItemId = (typeof CLEANUP_ITEMS)[number]["id"];

/**
 * What a run is doing, reported as it moves between them. Erasing is over in seconds on an ordinary
 * database, where recompressing every image and rebuilding the file are both measured in minutes —
 * so each says so rather than leaving the same message up throughout.
 */
export type CleanupPhase = "erasing" | "compressing" | "compacting";

/**
 * How far a phase has got, for the one phase that can say.
 *
 * Erasing and rebuilding are each a single request the server answers when it is finished; only
 * recompressing works through a list it knows the length of, and reports itself against it.
 */
export interface CleanupProgress {
    done: number;
    /** Absent until the run has said how many there are, which its first report does. */
    total?: number;
}


/**
 * What the cleanup tool is set to erase. Persisted as JSON in the `cleanupToolOptions` option — all
 * but the compacting step, see {@link storedCleanupOptions} — so the next run opens on the last
 * answer rather than on a fresh set of defaults.
 */
export interface CleanupToolOptions {
    deletedEntities: boolean;
    unusedAttachments: boolean;
    revisionSnapshots: boolean;
    /** Revision snapshots kept per note; 0 erases the history outright. */
    snapshotsToKeep: number;
    keepNamedSnapshots: boolean;
    /**
     * Recompress every image in the database, under {@link imageCompression}. Unlike the erasures,
     * this reclaims space from content that is being *kept* — so it frees bytes without anything
     * leaving the tree.
     */
    compressImages: boolean;
    /**
     * How images are recompressed when {@link compressImages} is on. The same settings the image
     * compression dialog works with, minus the subtree switch: a cleanup always runs over the whole
     * database, so there is no scope left to choose.
     */
    imageCompression: ImageCompressionToolOptions;
    /**
     * Rebuild the database file afterwards. Erasing hands pages back to the database, which reuses
     * them but never shrinks the file; only this returns the space to the disk.
     */
    compactDatabase: boolean;
}

/** Where the snapshots field starts when no useful limit is configured. */
export const FALLBACK_SNAPSHOTS_TO_KEEP = 4;

/**
 * Every request a run makes is a whole-database operation, and the default minute is nowhere near
 * enough for any of them on a large database: a rebuild alone has been measured at half an hour on
 * 36 GiB. Giving up early would not stop the server working — it would only lose the answer and
 * report a failure for something that went on to succeed.
 */
const CLEANUP_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Fills a stored setting out into the full set the dialog works with. Nothing is picked unless it
 * was picked before — an uninitialized setting erases nothing, which is the only safe reading of an
 * absent answer for an operation that deletes without recourse.
 */
export function readCleanupOptions(stored: Partial<CleanupToolOptions> | null | undefined): CleanupToolOptions {
    const snapshotsToKeep = stored?.snapshotsToKeep;

    return {
        deletedEntities: stored?.deletedEntities === true,
        unusedAttachments: stored?.unusedAttachments === true,
        revisionSnapshots: stored?.revisionSnapshots === true,
        snapshotsToKeep: Number.isInteger(snapshotsToKeep) && Number(snapshotsToKeep) >= 0
            ? Number(snapshotsToKeep)
            : defaultSnapshotsToKeep(),
        // Never answered here, the tool follows what the note revision settings say about named
        // revisions, rather than proposing a harsher trim than the one already configured.
        keepNamedSnapshots: stored?.keepNamedSnapshots ?? optionService.is("revisionIgnoreNamedSnapshots"),
        compressImages: stored?.compressImages === true,
        // Conservative where the dialog's own defaults are not: this runs over every image there is.
        imageCompression: readImageCompressionOptions(
            stored?.imageCompression, CONSERVATIVE_IMAGE_COMPRESSION_DEFAULTS),
        // Always starts unpicked, whatever the last run asked for: it is by far the most expensive
        // step, and one nobody should find themselves running because they forgot it was ticked.
        compactDatabase: false
    };
}

/**
 * What is worth remembering from a run: everything but the compacting step, which is deliberately
 * asked for afresh each time (see {@link readCleanupOptions}) and so is never written back.
 */
export function storedCleanupOptions(options: CleanupToolOptions): Partial<CleanupToolOptions> {
    const { compactDatabase: _unremembered, ...remembered } = options;

    return remembered;
}

/**
 * Whether the settings amount to anything worth running. Compacting counts on its own: it frees no
 * *accounted* bytes — the figures are about content, and it moves none — but it is the only step
 * that hands space back to the disk, so a run asking for nothing else is still a run.
 *
 * Compressing counts on its own for the opposite reason: it frees bytes the figures very much are
 * about, but no reading here says how many, since what an encoder will manage on an image is not
 * knowable without doing it. Its absence from the estimate is not evidence of nothing to do.
 */
export function hasWorkToDo(options: CleanupToolOptions, selectedBytes: number): boolean {
    return selectedBytes > 0 || options.compactDatabase || options.compressImages;
}

/**
 * How many snapshots the field offers to keep before anything has been stored: whatever the note
 * revision limit is set to, so the cleanup opens proposing the retention the user already chose. A
 * limit of -1 keeps everything and 0 keeps none — neither is a useful opening offer for a one-off
 * trim, so both fall back to a figure that plainly trims something without gutting the history.
 */
export function defaultSnapshotsToKeep(): number {
    const configured = optionService.getInt("revisionSnapshotNumberLimit") ?? -1;

    return configured > 0 ? configured : FALLBACK_SNAPSHOTS_TO_KEEP;
}

export interface CleanupSizes {
    /** What erasing each item would free, the revisions measured as the settings would trim them. */
    perItem: Record<CleanupItemId, number>;
    /** What a rebuild would return on top: the pages already free inside the file. */
    compaction: number;
    /** Everything reclaimable, the revisions measured at their most aggressive — see below. */
    total: number;
    /** What the picked items would free. */
    selected: number;
}

/**
 * The figures the dialog reads out, from the root's usage measured two ways.
 *
 * The whole is measured with the history erased outright, because that is the most any of these
 * settings can ever reclaim: keeping snapshots only takes away from it. Anything else would leave
 * the reading growing when the user asks to keep *less*, which is not what "of" can mean.
 *
 * @param everything root usage measured at `snapshotsToKeep=0`.
 * @param trimmed root usage measured as the current settings would trim it; the same reading as
 *                {@link everything} whenever those settings are the aggressive ones.
 */
export function computeCleanupSizes(
    everything: SpaceUsageNoteResponse | null,
    trimmed: SpaceUsageNoteResponse | null,
    options: CleanupToolOptions,
    compaction = 0
): CleanupSizes {
    const perItem: Record<CleanupItemId, number> = {
        deletedEntities: everything?.deletedNotes?.size ?? 0,
        unusedAttachments: everything?.unusedAttachments?.size ?? 0,
        revisionSnapshots: trimmed?.subtreeRevisionsContentSize ?? 0
    };
    const contentTotal = perItem.deletedEntities + perItem.unusedAttachments
        + (everything?.subtreeRevisionsContentSize ?? 0);

    return {
        perItem,
        compaction,
        // Added rather than folded in: the free pages a rebuild returns are ones erasing already
        // finished with, while the figures above weigh content still to be erased. The two never
        // describe the same byte.
        total: contentTotal + compaction,
        selected: CLEANUP_ITEMS.reduce((sum, item) => sum + (options[item.id] ? perItem[item.id] : 0), 0)
            + (options.compactDatabase ? compaction : 0)
    };
}

/**
 * Erases what the settings ask for, one endpoint per item, and reports what that actually freed.
 *
 * The figure is measured rather than estimated: the database is weighed on either side of the run
 * and the difference reported, so what the user is told matches what happened rather than what was
 * predicted. That costs two full measurements on top of the erasures, which is the price of quoting
 * a number that is true.
 *
 * The erasures run one after another rather than at once: each ends by purging the content it
 * orphaned, and there is nothing to be gained by having two of those scan the blobs at the same
 * time. Their order carries no weight beyond that — every one of them hands its own space back.
 *
 * Recompressing comes after all of them and before any rebuild. After, because an original a
 * revision still points at survives being replaced, so erasing the snapshots first is what lets the
 * originals go with them; before, because a rebuild has to close around the final state to return
 * the pages this frees.
 *
 * @returns what the run reclaimed, never negative: a note saved by another client mid-run must not
 *          read as the cleanup having given space back.
 */
export async function runCleanup(
    options: CleanupToolOptions,
    onPhase: (phase: CleanupPhase, progress?: CleanupProgress) => void = () => {}
): Promise<number> {
    const erasing = options.revisionSnapshots || options.unusedAttachments || options.deletedEntities;

    if (erasing) {
        onPhase("erasing");
    }

    // Only weighed when the file is not being rebuilt afterwards; a rebuild reports its own figure,
    // which is the better one and makes these two readings of the whole database wasted work.
    const before = options.compactDatabase ? 0 : await measureOccupiedBytes();

    if (options.revisionSnapshots) {
        await server.postWithTimeout("revisions/erase-all-excess-revisions", CLEANUP_TIMEOUT_MS, {
            snapshotsToKeep: options.snapshotsToKeep,
            keepNamedSnapshots: options.keepNamedSnapshots
        });
    }

    if (options.unusedAttachments) {
        await server.postWithTimeout("notes/erase-unused-attachments-now", CLEANUP_TIMEOUT_MS);
    }

    if (options.deletedEntities) {
        await server.postWithTimeout("notes/erase-deleted-notes-now", CLEANUP_TIMEOUT_MS);
    }

    if (options.compressImages) {
        onPhase("compressing");
        await compressAllImages(options.imageCompression,
            (done, total) => onPhase("compressing", { done, total }));
    }

    let compaction: VacuumDatabaseResponse | undefined;

    if (options.compactDatabase) {
        onPhase("compacting");
        // Last, with everything already erased: the rebuild closes around whatever is left, and its
        // own before/after is the truest figure there is — the file itself, rather than an account
        // of what the file holds. It subsumes the erasures above, whose pages it is what returns,
        // which is why it stands as the whole answer rather than as a figure beside theirs.
        compaction = await server.postWithTimeout<VacuumDatabaseResponse>(
            "database/vacuum-database", CLEANUP_TIMEOUT_MS);
    }

    const reclaimedBytes = compaction
        ? Math.max(compaction.sizeBefore - compaction.sizeAfter, 0)
        : Math.max(before - await measureOccupiedBytes(), 0);

    // Recorded on the server as well as shown here: this erased content past recovery, and the log
    // is where that is answerable for afterwards.
    await server.post("space-usage/cleanup-completed", { reclaimedBytes });

    return reclaimedBytes;
}

/**
 * Recompresses every image in the tree, as one request against the root note.
 *
 * The endpoint answers with what it saved, and that figure is deliberately *not* added to the run's
 * total. This step happens between the two readings the total is measured from, so those bytes are
 * already counted in it — adding them would report every one of them twice.
 *
 * The measured figure is the truer of the two anyway. What the endpoint reports is the difference
 * between the images it read and the ones it wrote, which is what compression achieved; what the
 * readings show is what the database actually handed back, which is smaller whenever a revision
 * still points at an original. Only the second is a claim about space, and space is what this tool
 * is answering for.
 *
 * Run through the image tool's own runner rather than posted from here, which is what names the run
 * and so what lets it be counted: the server reports each image against a task, and a task exists
 * only because the request quoted one. The count itself costs nothing to obtain — the run knows how
 * many images it collected before it touches the first, and says so with its first report.
 */
async function compressAllImages(
    options: ImageCompressionToolOptions,
    onProgress: (done: number, total: number | undefined) => void
): Promise<void> {
    await runImageCompression(
        { type: "note", noteId: "root" },
        // Always the whole tree: a cleanup is a database-wide operation, and the root note on its
        // own holds no images at all.
        { ...options, processChildNotes: true },
        newCompressionTaskId(),
        onProgress);
}

/**
 * What a rebuild would return, and what the database occupies now.
 *
 * The first is the pages already free inside the file, which erasing content puts there and only a
 * rebuild takes back — disjoint from the content figures, since those weigh live content that is
 * *about* to be freed and this weighs what already has been. The second is what the operation wants
 * as headroom while it runs, a rebuild being a fresh copy written before the original is replaced.
 */
export async function measureCompactionEstimate(): Promise<CompactionEstimateResponse> {
    return await server.get<CompactionEstimateResponse>("database/compaction-estimate");
}

/**
 * Every blob the space report accounts for: the live content plus what deleted entities still hold.
 * Blobs referenced by nothing at all are outside both, which is what makes this the right thing to
 * weigh — a snapshot erased but not yet purged has stopped being content and is on its way out, so
 * the reading falls by its size exactly as the estimate said it would.
 */
async function measureOccupiedBytes(): Promise<number> {
    // The smallest ranking the endpoint will do: the totals are whole-database figures either way,
    // and the listing this would return is of no use here.
    const overview = await server.getWithTimeout<SpaceUsageOverviewResponse>(
        "space-usage/overview?limit=1", CLEANUP_TIMEOUT_MS);

    return overview.content.size + overview.deletedNotes.size;
}
