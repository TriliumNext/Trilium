import {
    EraseExcessRevisionsOptions,
    SpaceUsageBucket,
    SpaceUsageContent,
    SpaceUsageDeletedNotes,
    SpaceUsageNoteResponse,
    SpaceUsageOverviewResponse,
    SpaceUsageSizes,
    SpaceUsageUnusedAttachments
} from "@triliumnext/commons";

import becca from "../becca/becca.js";
import { getLog } from "./log.js";
import { getSql } from "./sql/index.js";

/**
 * Space usage reporting for the Content Manager: how much of the database each note occupies.
 *
 * All byte counting happens in a handful of grouped SQL queries — one pass over the blobs per
 * request, never a query per note. The tree walks stay on becca, which already holds the whole tree
 * in memory.
 *
 * A cloned note lives in several places but occupies space once, so every note is counted at exactly
 * one **canonical placement**: the parent through which it is first reached by a breadth-first walk
 * from the root that enters the hidden subtree last. Reachable outside the hidden subtree means the
 * note is part of the user's visible tree; everything else — launchers, options, orphans — is
 * aggregated into a "hidden" bucket rather than listed note by note.
 *
 * Sizes are `LENGTH(blobs.content)` like the existing per-note stats endpoints, so the numbers match
 * what the note info widget already shows. Blobs shared between entities through deduplication are
 * counted at each entity, so per-note numbers stay meaningful; the reclaimable aggregates — deleted
 * notes and unused attachments — are the exception, counting only blobs nothing else would keep
 * alive, i.e. what erasing would really free.
 */

export const DEFAULT_OVERVIEW_LIMIT = 500;
export const MAX_OVERVIEW_LIMIT = 1000;

const ROOT_NOTE_ID = "root";
const HIDDEN_ROOT_ID = "_hidden";

const LOG_PREFIX = "Space Usage Analyzer: ";

function log(message: string) {
    getLog().info(`${LOG_PREFIX}${message}`);
}

/**
 * Reports how long a step took. These endpoints read the whole database, so when one is slow the
 * only useful question is *which* part was slow — on a large database that is almost always the
 * measuring pass, and the log says so rather than leaving it to be guessed.
 */
function timed<T>(step: string, run: () => T): T {
    const startedAt = Date.now();

    try {
        return run();
    } finally {
        log(`${step} took ${Date.now() - startedAt} ms.`);
    }
}

export function getOverview(options: { includeRevisions: boolean, limit: number }): SpaceUsageOverviewResponse {
    log(`building the overview (limit ${options.limit}, `
        + `revisions ${options.includeRevisions ? "included" : "excluded"})...`);

    return timed("the overview", () => {
        const overview = withBlobUsage(() => buildOverview(options));

        log(`the overview lists ${overview.notes.length} of ${overview.content.noteCount} notes, `
            + `holding ${overview.content.size} bytes.`);

        return overview;
    });
}

function buildOverview({ includeRevisions, limit }: { includeRevisions: boolean, limit: number }): SpaceUsageOverviewResponse {
    const sizes = timed("adding the sizes up per note", collectSizes);
    const forest = timed("placing the notes in the tree", buildForestFromBecca);
    const rankOf = (entry: SpaceUsageSizes) =>
        entry.ownSize + entry.attachmentsSize + (includeRevisions ? entry.revisionsSize : 0);

    const ranked = forest.userNoteIds
        .map((noteId) => ({ noteId, ...sizesOf(noteId, sizes) }))
        .sort((a, b) => rankOf(b) - rankOf(a) || a.noteId.localeCompare(b.noteId));

    // Zero-sized notes are never worth an individual tile, even when the tree is smaller than the
    // ranking cutoff — they go to the bucket, where they still count.
    const top: typeof ranked = [];
    const others: typeof ranked = [];
    for (const [ index, entry ] of ranked.entries()) {
        (index < limit && rankOf(entry) > 0 ? top : others).push(entry);
    }

    return {
        content: collectContent(),
        notes: top.map(({ noteId, ...entrySizes }) => ({
            noteId,
            notePath: buildNotePath(forest.parentByNoteId, noteId),
            ...entrySizes
        })),
        otherNotes: bucketOf(others),
        hiddenNotes: bucketOf(forest.hiddenNoteIds.map((noteId) => sizesOf(noteId, sizes))),
        deletedNotes: collectDeletedNotes(),
        unusedAttachments: collectUnusedAttachments(),
        total: bucketOf(ranked)
    };
}

export function getNoteUsage(
    noteId: string,
    revisionOptions: EraseExcessRevisionsOptions = {}
): SpaceUsageNoteResponse {
    // Resolved before the measuring pass, so a bad note ID costs nothing.
    const note = becca.getNoteOrThrow(noteId);

    log(`measuring note ${note.noteId} and its subtree...`);

    return timed(`note ${note.noteId}`, () => withBlobUsage(() => buildNoteUsage(note.noteId, revisionOptions)));
}

function buildNoteUsage(noteId: string, revisionOptions: EraseExcessRevisionsOptions): SpaceUsageNoteResponse {
    const note = becca.getNoteOrThrow(noteId);
    const sizes = timed("adding the sizes up per note", collectSizes);
    const forest = timed("placing the notes in the tree", buildForestFromBecca);
    const totals = timed("adding the subtrees up", () => computeSubtreeTotals(forest, (id) => sizesOf(id, sizes)));

    const children = (forest.childrenByNoteId.get(noteId) ?? []).map((childId) => {
        const total = totals.get(childId);

        return {
            noteId: childId,
            /* v8 ignore next 3 -- the totals cover every note of the forest, so the fallbacks
               would only fire on an internally inconsistent forest */
            subtreeSize: total?.size ?? 0,
            subtreeNoteCount: total?.noteCount ?? 0
        };
    });

    const attachmentSizes = getSql().getMap<string, number>(
        `
        SELECT attachments.attachmentId, blob_usage.size
        FROM attachments
        JOIN blob_usage ON blob_usage.blobId = attachments.blobId
        WHERE attachments.ownerId = ? AND attachments.isDeleted = 0`,
        [ noteId ]
    );
    const attachments = note.getAttachments().flatMap((attachment) => {
        /* v8 ignore next 3 -- a becca-loaded attachment always carries its row ID; the type merely
           allows unsaved ones */
        if (!attachment.attachmentId) {
            return [];
        }

        return [ {
            attachmentId: attachment.attachmentId,
            title: attachment.getTitleOrProtected(),
            role: attachment.role,
            size: attachmentSizes[attachment.attachmentId] ?? 0
        } ];
    });

    const subtreeNoteIds = collectSubtreeNoteIds(forest, noteId);

    return {
        noteId,
        ...sizesOf(noteId, sizes),
        noteContentSize: collectContentSizeOf([ noteId ]),
        subtreeContentSize: collectContentSizeOf(subtreeNoteIds),
        subtreeRevisionsContentSize: collectRevisionsSizeOf(subtreeNoteIds, revisionOptions),
        attachments,
        children,
        // Deleted notes have no place in the tree, so they surface once, at its root. Unused
        // attachments do have one, but the figure is what erasing *all* of them would reclaim —
        // a database-wide number like the deleted one, so it belongs in the same place.
        ...(noteId === ROOT_NOTE_ID
            ? { deletedNotes: collectDeletedNotes(), unusedAttachments: collectUnusedAttachments() }
            : {})
    };
}

/**
 * Every live note's single place in the tree. The three collections cover exactly the live notes:
 * a note is either in the user walk or in the hidden walk, and has a parent unless it is the root
 * or unreachable.
 */
export interface CanonicalForest {
    /** Canonical parent per note; the root and unreachable notes are absent. */
    parentByNoteId: Map<string, string>;
    /** Canonical children in tree order; a cloned note appears under its canonical parent only. */
    childrenByNoteId: Map<string, string[]>;
    /** Notes reachable outside the hidden subtree, in breadth-first order starting at the root. */
    userNoteIds: string[];
    /** Notes reachable only through the hidden subtree, then any note not reachable at all. */
    hiddenNoteIds: string[];
}

/**
 * Assigns every note its canonical placement: two breadth-first walks, the visible tree first and
 * the hidden subtree second, each note adopted by the parent that reaches it first. A note cloned
 * into both worlds therefore counts as a user note, which is what keeps bookmarks — clones under
 * the hidden bookmarks folder — in the visible listing.
 *
 * @param getChildNoteIds child note IDs in tree order; queried for every visited note.
 * @param allNoteIds every live note, so the walks can sweep up the unreachable leftovers.
 */
export function buildCanonicalForest(
    getChildNoteIds: (noteId: string) => string[],
    allNoteIds: Iterable<string>,
    rootNoteId = ROOT_NOTE_ID,
    hiddenRootId = HIDDEN_ROOT_ID
): CanonicalForest {
    const parentByNoteId = new Map<string, string>();
    const childrenByNoteId = new Map<string, string[]>();
    // Pre-marking the hidden root keeps the first walk out of the hidden subtree.
    const visited = new Set<string>([ rootNoteId, hiddenRootId ]);

    /** Walks breadth-first from the queued notes, recording each adoption. The queue is its own
     *  cursor-scanned array — `shift()` would make the walk quadratic. */
    const walk = (queue: string[]) => {
        for (let i = 0; i < queue.length; i++) {
            const noteId = queue[i];

            for (const childId of getChildNoteIds(noteId)) {
                if (visited.has(childId)) {
                    continue;
                }

                visited.add(childId);
                parentByNoteId.set(childId, noteId);
                childrenByNoteId.set(noteId, [ ...(childrenByNoteId.get(noteId) ?? []), childId ]);
                queue.push(childId);
            }
        }

        return queue;
    };

    const allIds = new Set(allNoteIds);
    const userNoteIds = walk([ rootNoteId ]);
    const hiddenNoteIds: string[] = [];

    if (allIds.has(hiddenRootId)) {
        parentByNoteId.set(hiddenRootId, rootNoteId);
        // Appended after the user children, so the hidden subtree lists last under the root.
        childrenByNoteId.set(rootNoteId, [ ...(childrenByNoteId.get(rootNoteId) ?? []), hiddenRootId ]);
        appendAll(hiddenNoteIds, walk([ hiddenRootId ]));
    }

    // A note reachable from nowhere still occupies space: adopt each such subtree so it is at least
    // counted in the hidden bucket, even though nothing links to it.
    for (const noteId of allIds) {
        if (!visited.has(noteId)) {
            visited.add(noteId);
            appendAll(hiddenNoteIds, walk([ noteId ]));
        }
    }

    return { parentByNoteId, childrenByNoteId, userNoteIds, hiddenNoteIds };
}

/** Spreading can overflow the argument limit on a huge walk, so appending stays a loop. */
function appendAll(target: string[], items: string[]) {
    for (const item of items) {
        target.push(item);
    }
}

/** The aggregate of a note's whole canonical subtree, the note itself included. */
export interface SubtreeTotal {
    /**
     * Bodies plus attachments. Revisions are absent on purpose: summing the per-entity figures would
     * count a snapshot's blob again at every entity sharing it, so a subtree's history is measured
     * deduplicated instead, by {@link collectRevisionsSizeOf}.
     */
    size: number;
    noteCount: number;
}

/**
 * Sums every canonical subtree in one linear pass: children strictly follow their parent in each
 * breadth-first order, so walking the orders backwards folds each finished subtree into its parent.
 * The hidden order goes first because its root folds into the tree root, which the user order still
 * has to fold children into afterwards — additions commute, only completeness matters. Iterative on
 * purpose: a pathologically deep tree must not blow the stack.
 */
export function computeSubtreeTotals(
    forest: CanonicalForest,
    getSizes: (noteId: string) => SpaceUsageSizes
): Map<string, SubtreeTotal> {
    const totals = new Map<string, SubtreeTotal>();

    for (const noteId of [ ...forest.userNoteIds, ...forest.hiddenNoteIds ]) {
        const { ownSize, attachmentsSize } = getSizes(noteId);
        totals.set(noteId, { size: ownSize + attachmentsSize, noteCount: 1 });
    }

    for (const order of [ forest.hiddenNoteIds, forest.userNoteIds ]) {
        for (let i = order.length - 1; i >= 0; i--) {
            const total = totals.get(order[i]);
            const parentId = forest.parentByNoteId.get(order[i]);
            const parentTotal = parentId === undefined ? undefined : totals.get(parentId);

            if (!total || !parentTotal) {
                continue;
            }

            parentTotal.size += total.size;
            parentTotal.noteCount += total.noteCount;
        }
    }

    return totals;
}

/** The note's whole canonical subtree, itself included — the canonical forest is a tree, so no
 *  note is visited twice. The queue is its own cursor-scanned array, keeping deep trees safe. */
export function collectSubtreeNoteIds(forest: CanonicalForest, noteId: string): string[] {
    const queue = [ noteId ];

    for (let i = 0; i < queue.length; i++) {
        for (const childId of forest.childrenByNoteId.get(queue[i]) ?? []) {
            queue.push(childId);
        }
    }

    return queue;
}

/** The note's canonical ancestor chain, root excluded, ending with the note itself. */
export function buildNotePath(parentByNoteId: Map<string, string>, noteId: string, rootNoteId = ROOT_NOTE_ID): string[] {
    const path: string[] = [];

    for (let current: string | undefined = noteId; current !== undefined && current !== rootNoteId; current = parentByNoteId.get(current)) {
        path.push(current);
    }

    return path.reverse();
}

type SizeLookup = Map<string, SpaceUsageSizes>;

/**
 * Every note's own components, in one grouped query over the measured blobs. Notes holding nothing
 * produce no row and are simply absent, which keeps the map to what actually occupies space.
 */
function collectSizes(): SizeLookup {
    const rows = getSql().getRows<{
        noteId: string, ownSize: number, attachmentsSize: number, revisionsSize: number
    }>(`
        SELECT noteId,
               SUM(own) AS ownSize,
               SUM(attachment) AS attachmentsSize,
               SUM(revision) AS revisionsSize
        FROM (
            SELECT notes.noteId AS noteId, blob_usage.size AS own, 0 AS attachment, 0 AS revision
            FROM notes
            JOIN blob_usage ON blob_usage.blobId = notes.blobId
            WHERE notes.isDeleted = 0

            UNION ALL
            -- Owners that are revisions rather than notes never match a live noteId here; those
            -- attachments are picked up by the revision branch below.
            SELECT attachments.ownerId, 0, blob_usage.size, 0
            FROM attachments
            JOIN blob_usage ON blob_usage.blobId = attachments.blobId
            WHERE attachments.isDeleted = 0

            UNION ALL
            SELECT revisions.noteId, 0, 0, blob_usage.size
            FROM revisions
            JOIN blob_usage ON blob_usage.blobId = revisions.blobId

            UNION ALL
            SELECT revisions.noteId, 0, 0, blob_usage.size
            FROM attachments
            JOIN revisions ON revisions.revisionId = attachments.ownerId
            JOIN blob_usage ON blob_usage.blobId = attachments.blobId
            WHERE attachments.isDeleted = 0
        )
        GROUP BY noteId`);

    return new Map(rows.map(({ noteId, ownSize, attachmentsSize, revisionsSize }) =>
        [ noteId, { ownSize, attachmentsSize, revisionsSize } ]));
}

const NO_SIZES: SpaceUsageSizes = { ownSize: 0, attachmentsSize: 0, revisionsSize: 0 };

function sizesOf(noteId: string, sizes: SizeLookup): SpaceUsageSizes {
    return sizes.get(noteId) ?? NO_SIZES;
}

function bucketOf(entries: SpaceUsageSizes[]): SpaceUsageBucket {
    const bucket = { size: 0, revisionsSize: 0, noteCount: entries.length };

    for (const entry of entries) {
        bucket.size += entry.ownSize + entry.attachmentsSize;
        bucket.revisionsSize += entry.revisionsSize;
    }

    return bucket;
}

/**
 * What still keeps a blob alive, in ascending priority. A blob claimed by several kinds is
 * attributed to the highest, which is what makes the reported tiers add up to the total instead of
 * counting shared content twice.
 */
const BLOB_UNREFERENCED = 0;
const BLOB_DELETED = 1;
const BLOB_REVISION = 2;
const BLOB_ATTACHMENT = 3;
const BLOB_BODY = 4;

const DELETED_BLOBS = `
    SELECT blobId FROM notes WHERE isDeleted = 1 AND blobId IS NOT NULL
    UNION SELECT blobId FROM attachments WHERE isDeleted = 1 AND blobId IS NOT NULL
    UNION SELECT revisions.blobId FROM revisions
        JOIN notes ON notes.noteId = revisions.noteId
        WHERE notes.isDeleted = 1 AND revisions.blobId IS NOT NULL`;

const LIVE_BODY_BLOBS = `SELECT blobId FROM notes WHERE isDeleted = 0 AND blobId IS NOT NULL`;

const LIVE_NOTE_ATTACHMENT_BLOBS = `
    SELECT attachments.blobId FROM attachments
    JOIN notes ON notes.noteId = attachments.ownerId
    WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0 AND attachments.blobId IS NOT NULL`;

/**
 * Attachments a live note owns but whose content no longer mentions them, which saving the note
 * marked for erasure (see `checkImageAttachments`). They are live rows, so the tagging above counts
 * them among the live attachments — measuring what erasing them frees takes {@link
 * collectUnusedAttachments}.
 */
const UNUSED_ATTACHMENT_BLOBS = `
    SELECT attachments.blobId FROM attachments
    JOIN notes ON notes.noteId = attachments.ownerId
    WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0 AND attachments.blobId IS NOT NULL
    AND attachments.utcDateScheduledForErasureSince IS NOT NULL`;

/** The rest of {@link LIVE_NOTE_ATTACHMENT_BLOBS}: those a note still references. */
const USED_NOTE_ATTACHMENT_BLOBS = `
    SELECT attachments.blobId FROM attachments
    JOIN notes ON notes.noteId = attachments.ownerId
    WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0 AND attachments.blobId IS NOT NULL
    AND attachments.utcDateScheduledForErasureSince IS NULL`;

const LIVE_REVISION_BLOBS = `
    SELECT revisions.blobId FROM revisions
    JOIN notes ON notes.noteId = revisions.noteId
    WHERE notes.isDeleted = 0 AND revisions.blobId IS NOT NULL
    UNION
    SELECT attachments.blobId FROM attachments
    JOIN revisions ON revisions.revisionId = attachments.ownerId
    JOIN notes ON notes.noteId = revisions.noteId
    WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0 AND attachments.blobId IS NOT NULL`;

/**
 * Measures every blob exactly once into a temporary table, tags each with what still keeps it
 * alive, and runs the caller against that.
 *
 * This is the only pass over blob content a request makes, and it is what keeps these endpoints
 * usable on a large database. Measuring is the expensive part — everything downstream then joins
 * integers. The shape this replaced re-measured the whole database for each figure it reported,
 * seven times over; since the SQLite connection is synchronous, the server could serve nothing at
 * all meanwhile, so a slow report froze the whole app rather than just this page.
 */
function withBlobUsage<T>(collect: () => T): T {
    const sql = getSql();

    // A leftover from a request that died mid-flight would otherwise be reused as if it were fresh.
    sql.execute("DROP TABLE IF EXISTS blob_usage");

    try {
        sql.execute(`
            CREATE TEMP TABLE blob_usage (
                blobId TEXT NOT NULL PRIMARY KEY,
                size INTEGER NOT NULL,
                kind INTEGER NOT NULL DEFAULT ${BLOB_UNREFERENCED}
            )`);

        // One statement measures and sorts every blob at once.
        //
        // `octet_length`, not `length`: on a text value `length` counts *characters*, so it has to
        // decode every note in the database. Bytes are what a space report is about anyway — the
        // character count also under-reported anything non-ASCII.
        //
        // The `CASE` reads top-down, so the strongest claim on a blob wins and each reference set
        // is built once for the whole scan. Assigning the kinds here rather than in follow-up
        // `UPDATE`s also keeps the pass to a single write.
        //
        // The leading comment is load-bearing: `execute()` drops any statement *starting with*
        // `INSERT`/`UPDATE`/`DELETE` when the database is read-only (`[General] readOnly`), and
        // dropping this one would leave the table empty and every figure silently zero. Writing to
        // a temp table is legitimate there — SQLite keeps the temp database separate and writable
        // even when the main one is opened read-only — so the statement must not look like a write
        // to the main database.
        const measured = timed("measuring the blobs", () => sql.execute(`
            /* Into the temp database, which stays writable on a read-only connection. */
            INSERT INTO blob_usage (blobId, size, kind)
            SELECT blobs.blobId,
                   COALESCE(octet_length(blobs.content), 0),
                   CASE
                       WHEN blobs.blobId IN (${LIVE_BODY_BLOBS}) THEN ${BLOB_BODY}
                       WHEN blobs.blobId IN (${LIVE_NOTE_ATTACHMENT_BLOBS}) THEN ${BLOB_ATTACHMENT}
                       WHEN blobs.blobId IN (${LIVE_REVISION_BLOBS}) THEN ${BLOB_REVISION}
                       WHEN blobs.blobId IN (${DELETED_BLOBS}) THEN ${BLOB_DELETED}
                       ELSE ${BLOB_UNREFERENCED}
                   END
            FROM blobs`));

        log(`measured ${measured.changes} blobs.`);

        return collect();
    } finally {
        // The connection outlives the request, so the table must not linger for the next one.
        sql.execute("DROP TABLE IF EXISTS blob_usage");
    }
}

/**
 * What the live content actually occupies on disk, deduplicated, broken into mutually exclusive
 * tiers: bodies claim their blobs first, then note-owned attachments, then revisions (snapshot
 * attachments included). The tiers sum to the total by construction, so each parenthetical figure
 * reads as "the space that would go away if only this category vanished". The per-entity numbers
 * elsewhere deliberately count differently; this is the one figure comparable to the database's
 * real size.
 */
function collectContent(): SpaceUsageContent {
    const sql = getSql();
    const byKind = new Map(sql
        .getRows<{ kind: number, size: number }>(`SELECT kind, SUM(size) AS size FROM blob_usage GROUP BY kind`)
        .map(({ kind, size }) => [ kind, size ]));
    const sizeOf = (kind: number) => byKind.get(kind) ?? 0;

    const attachmentsSize = sizeOf(BLOB_ATTACHMENT);
    const revisionsSize = sizeOf(BLOB_REVISION);

    return {
        size: sizeOf(BLOB_BODY) + attachmentsSize + revisionsSize,
        noteCount: sql.getValue<number>(`SELECT COUNT(*) FROM notes WHERE isDeleted = 0`),
        attachmentsSize,
        revisionsSize
    };
}

/**
 * Like {@link collectContentSize}, but restricted to the given notes: every blob referenced by
 * their bodies, their attachments, their revisions or those revisions' attachments, counted once.
 * This is what makes a note's — or a subtree's — figure comparable to the database-content one.
 */
function collectContentSizeOf(noteIds: string[]): number {
    const sql = getSql();
    sql.fillParamList(noteIds);

    return sql.getValue<number | null>(`
        SELECT SUM(blob_usage.size)
        FROM blob_usage
        WHERE blob_usage.blobId IN (
            SELECT notes.blobId FROM notes
                JOIN param_list ON param_list.paramId = notes.noteId
                WHERE notes.isDeleted = 0 AND notes.blobId IS NOT NULL
            UNION SELECT attachments.blobId FROM attachments
                JOIN param_list ON param_list.paramId = attachments.ownerId
                WHERE attachments.isDeleted = 0 AND attachments.blobId IS NOT NULL
            UNION SELECT revisions.blobId FROM revisions
                JOIN param_list ON param_list.paramId = revisions.noteId
                WHERE revisions.blobId IS NOT NULL
            UNION SELECT attachments.blobId FROM attachments
                JOIN revisions ON revisions.revisionId = attachments.ownerId
                JOIN param_list ON param_list.paramId = revisions.noteId
                WHERE attachments.isDeleted = 0 AND attachments.blobId IS NOT NULL
        )`) ?? 0;
}

/**
 * The revision tier of {@link collectContentSizeOf}: an estimate of what trimming the given notes'
 * history would reclaim. Deduplicated, and subtracted against the *database-wide* live bodies and
 * note attachments exactly as {@link collectContent} does — a snapshot still sharing its blob with
 * any live note frees nothing, so it counts for zero here. That tiering is what makes a subtree's
 * figure comparable to the database-wide one, and what separates this from the per-entity
 * `revisionsSize`, which counts a shared snapshot again at every entity holding it.
 *
 * The options are the ones "Erase excess revision snapshots" itself takes, so the figure answers
 * what *that* operation would free rather than a number the action never delivers. Their absence
 * keeps every snapshot doomed — the same figure as before they existed, and the one to report when
 * nothing narrower was asked for.
 *
 * An estimate rather than a promise, because the limit it answers for is one number across every
 * note, while the operation follows each note's own `#versioningLimit` wherever one is set — a label
 * outranks the limit asked for here, being a policy set on that note deliberately. A note labelled
 * to keep more than the stated limit therefore frees less than its share of this figure, so the
 * estimate reads high, which is the direction an estimate of reclaimable space should err in.
 *
 * @param revisionOptions how far the trimming being estimated would go; `snapshotsToKeep` defaults
 *                        to 0, which dooms the lot.
 */
function collectRevisionsSizeOf(
    noteIds: string[],
    { snapshotsToKeep, keepNamedSnapshots }: EraseExcessRevisionsOptions
): number {
    const snapshotsKept = Number.isInteger(snapshotsToKeep) ? Number(snapshotsToKeep) : 0;

    // Nothing is ever excess once every snapshot is kept, so there is no query to run.
    if (snapshotsKept < 0) {
        return 0;
    }

    const sql = getSql();
    sql.fillParamList(noteIds);

    // The snapshots the trimming would take: per note the oldest ones past the allowance, ranked
    // newest-first, sparing the named ones from the ranking altogether when they are to be kept —
    // the same reckoning `BNote.eraseExcessRevisionSnapshots` makes. The revisionId tie-break only
    // settles snapshots saved within the same millisecond, which the ordering alone cannot.
    const doomed = `
        SELECT revisionId, blobId FROM (
            SELECT revisions.revisionId, revisions.blobId,
                   ROW_NUMBER() OVER (
                       PARTITION BY revisions.noteId
                       ORDER BY revisions.utcDateCreated DESC, revisions.revisionId DESC
                   ) AS age
            FROM revisions
            JOIN param_list ON param_list.paramId = revisions.noteId
            ${keepNamedSnapshots ? "WHERE revisions.description IS NULL OR revisions.description = ''" : ""}
        )
        WHERE age > ${snapshotsKept}`;

    return sql.getValue<number | null>(`
        WITH doomed AS (${doomed})
        SELECT SUM(blob_usage.size)
        FROM blob_usage
        WHERE blob_usage.blobId IN (
            SELECT blobId FROM doomed WHERE blobId IS NOT NULL
            UNION SELECT attachments.blobId FROM attachments
                JOIN doomed ON doomed.revisionId = attachments.ownerId
                WHERE attachments.isDeleted = 0 AND attachments.blobId IS NOT NULL
        )
        -- The same subtraction the database-wide tiers make, read off the tag each blob already
        -- carries: one still held by a live body or note attachment frees nothing.
        AND blob_usage.kind NOT IN (${BLOB_BODY}, ${BLOB_ATTACHMENT})
        -- And neither does one a snapshot that survives the trimming still holds — the spared named
        -- ones, the newest kept per note, and every snapshot of every note outside this subtree.
        -- Unchanged content is snapshotted onto the same blob over and over, so without this the
        -- estimate would promise the same bytes back once per doomed snapshot sharing them.
        AND blob_usage.blobId NOT IN (${SURVIVING_REVISION_BLOBS})`) ?? 0;
}

/**
 * Live-note revision blobs that a trimming would leave behind: {@link LIVE_REVISION_BLOBS} minus
 * the snapshots being erased. Only valid inside a query defining the `doomed` set.
 */
const SURVIVING_REVISION_BLOBS = `
    SELECT revisions.blobId FROM revisions
    JOIN notes ON notes.noteId = revisions.noteId
    WHERE notes.isDeleted = 0 AND revisions.blobId IS NOT NULL
    AND revisions.revisionId NOT IN (SELECT revisionId FROM doomed)
    UNION
    SELECT attachments.blobId FROM attachments
    JOIN revisions ON revisions.revisionId = attachments.ownerId
    JOIN notes ON notes.noteId = revisions.noteId
    WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0 AND attachments.blobId IS NOT NULL
    AND revisions.revisionId NOT IN (SELECT revisionId FROM doomed)`;

/**
 * What erasing would actually reclaim: blobs referenced by deleted entities and by no live one.
 * Deduplicated by blobId — several deleted clones of the same content free that content once.
 *
 * Every `NOT IN` subquery must filter out NULL blob IDs: a single NULL in the set makes `NOT IN`
 * evaluate to NULL for every row, silently emptying the whole result.
 */
function collectDeletedNotes(): SpaceUsageDeletedNotes {
    const sql = getSql();

    return {
        // Blobs no live entity claimed: the tagging already resolved that, a live claim of any kind
        // having overwritten the deleted one.
        size: sql.getValue<number | null>(
            `SELECT SUM(size) FROM blob_usage WHERE kind = ${BLOB_DELETED}`) ?? 0,
        noteCount: sql.getValue<number>(`
            SELECT COUNT(*)
            FROM notes
            JOIN blob_usage ON blob_usage.blobId = notes.blobId
            WHERE notes.isDeleted = 1`),
        // Counted beside the notes because most of the reported space is usually theirs: an
        // attachment is deleted on its own whenever one is replaced (a canvas re-render, a
        // re-uploaded image), which leaves content awaiting erasure without a single note being
        // deleted. Reported as "in 0 notes", that space looked like it came from nowhere.
        attachmentCount: sql.getValue<number>(`
            SELECT COUNT(*)
            FROM attachments
            JOIN blob_usage ON blob_usage.blobId = attachments.blobId
            WHERE attachments.isDeleted = 1`)
    };
}

/**
 * What erasing the unused attachments would reclaim, deduplicated by blobId — several of them
 * holding the same content free it once.
 *
 * The blob tags cannot answer this on their own: an unused attachment is still a live attachment,
 * so it claims its blob as {@link BLOB_ATTACHMENT} and hides whatever else holds it. Every other
 * live claim is therefore re-checked here, the body one off the tag (bodies outrank attachments, so
 * a shared blob still reads as one) and the two the tag swallowed by subquery.
 *
 * A blob a *deleted* entity also holds counts here rather than in {@link collectDeletedNotes},
 * whose figure the same live-attachment claim already excludes it from: erasing both cleanups frees
 * it, and it is reported once, under the strongest claim on it.
 */
function collectUnusedAttachments(): SpaceUsageUnusedAttachments {
    const sql = getSql();

    return {
        size: sql.getValue<number | null>(`
            SELECT SUM(blob_usage.size)
            FROM blob_usage
            WHERE blob_usage.blobId IN (${UNUSED_ATTACHMENT_BLOBS})
            AND blob_usage.kind != ${BLOB_BODY}
            AND blob_usage.blobId NOT IN (${USED_NOTE_ATTACHMENT_BLOBS})
            AND blob_usage.blobId NOT IN (${LIVE_REVISION_BLOBS})`) ?? 0,
        // Every scheduled attachment, shared content included: the count says how many the cleanup
        // would remove, the size how much that would actually free.
        attachmentCount: sql.getValue<number>(`
            SELECT COUNT(*)
            FROM attachments
            JOIN notes ON notes.noteId = attachments.ownerId
            JOIN blob_usage ON blob_usage.blobId = attachments.blobId
            WHERE attachments.isDeleted = 0 AND notes.isDeleted = 0
            AND attachments.utcDateScheduledForErasureSince IS NOT NULL`)
    };
}

function buildForestFromBecca(): CanonicalForest {
    return buildCanonicalForest(
        (noteId) => {
            const note = becca.notes[noteId];
            /* v8 ignore next 3 -- only visited IDs are queried, and those come from becca itself */
            if (!note) {
                return [];
            }

            return note.getChildBranches()
                /* v8 ignore next -- getChildBranches' nulls only appear on a corrupted cache */
                .flatMap((branch) => branch ? [ branch ] : [])
                // Sorted here rather than trusting cache order, so the canonical choice between
                // equally deep clones is the same on every instance of a sync cluster.
                .sort((a, b) => a.notePosition - b.notePosition || a.noteId.localeCompare(b.noteId))
                .map((branch) => branch.noteId);
        },
        Object.keys(becca.notes)
    );
}
