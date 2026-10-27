/**
 * On-demand image compression: shrinks the images a note already holds, when the user asks for it.
 *
 * The `compressImages` option shrinks images as they come in, and is usually left off because it
 * costs quality on every image regardless. This service is the other half of that trade: nothing
 * happens automatically, but a single note (or a single image) whose attachments have grown out of
 * hand can be shrunk deliberately, accepting the quality loss for that one note alone. It therefore
 * runs whether or not the option is enabled.
 *
 * What it decides is *which* images to visit and what to write back; how a single image is actually
 * recompressed belongs to the platform's {@link ImageProvider}.
 */

import { type AttachmentRow, getImageAttachmentTitle, IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS, type ImageCompressionItem, type ImageCompressionOptions, type ImageCompressionResponse, type ImageCompressionSkipReason } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import BAttachment from "../becca/entities/battachment.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { getImageProvider, type ImageCompressionRequest } from "./image_provider.js";
import { getContext } from "./context.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import { runWithinBudget } from "./parallel_budget.js";
import { getSql } from "./sql/index.js";
import TaskContext from "./task_context.js";
import { wrapStringOrBuffer } from "./utils/binary.js";

/** Quality bounds shared with the automatic shrinking, so the two cannot drift apart. */
const MIN_QUALITY = 10;
const MAX_QUALITY = 100;
const DEFAULT_QUALITY = 75;

/**
 * Where converting a lossless image starts, deliberately above {@link DEFAULT_QUALITY}: this is a
 * one-time transition away from a pristine original, so quality given up here is detail that was
 * genuinely there. Recompressing an image that has already been through an encoder is the opposite
 * trade — the loss is baked in, and spending quality on it buys back little.
 */
const DEFAULT_CONVERSION_QUALITY = 85;
/** A one-pixel bound is pointless but harmless; anything below it cannot be resized to. */
const MIN_MAX_WIDTH_HEIGHT = 1;

/**
 * Calls off a run that is still going, by the name its caller gave it.
 *
 * Takes effect between images rather than during one: an image already being decoded is finished
 * and written, because stopping a worker mid-decode saves a second and loses the work. Everything
 * committed stays committed — the run writes as it goes — and running the tool again picks up where
 * this left off, since what is already compressed is recognised from its header and skipped.
 */
export function cancelImageCompression(taskId: string) {
    cancelledRuns.add(taskId);
}

/**
 * Runs called off and not yet finished.
 *
 * Emptied by the run itself on its way out, so a name reused by a later run does not arrive
 * pre-cancelled.
 */
const cancelledRuns = new Set<string>();

/** Compresses every image the given note holds: an image note's own content, or its attachments. */
export async function compressNoteImages(noteId: string, options?: ImageCompressionOptions): Promise<ImageCompressionResponse> {
    const note = becca.getNote(noteId);

    if (!note) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }

    return compressTargets(
        collectNoteTargets(note, resolveRecursive(options)), resolveCompressionRequest(options), options?.taskId);
}

/** Compresses one image attachment, under exactly the rules a whole-note run would apply to it. */
export async function compressAttachmentImage(attachmentId: string, options?: ImageCompressionOptions): Promise<ImageCompressionResponse> {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        throw new NotFoundError(`Attachment '${attachmentId}' was not found.`);
    }

    if (attachment.role !== "image") {
        throw new ValidationError(`Attachment '${attachmentId}' has role '${attachment.role}', but 'image' was expected.`);
    }

    return compressTargets([ attachmentTarget(attachment) ], resolveCompressionRequest(options), options?.taskId);
}

/**
 * Fills in what the request left out and rejects what it got wrong, so a provider always receives
 * complete, sane parameters. An out-of-range stored option falls back to the default rather than
 * failing the request — the caller did not choose that value and cannot fix it from here.
 */
export function resolveCompressionRequest(options: ImageCompressionOptions = {}): ImageCompressionRequest {
    const { resize, maxWidthHeight, jpegHandling, pngHandling, quality, conversionQuality } = options;

    requireQuality(quality, "quality");
    requireQuality(conversionQuality, "conversionQuality");
    requireBoolean(resize, "resize");
    requireOneOf(jpegHandling, IMAGE_JPEG_HANDLINGS, "jpegHandling");
    requireOneOf(pngHandling, IMAGE_PNG_HANDLINGS, "pngHandling");

    return {
        // Every step defaults to acting: a request that named none of them asked for the images to
        // be compressed, and narrowing that down is what the fields are for. For a PNG that means
        // being made smaller without ceasing to be one.
        resize: resize ?? true,
        maxWidthHeight: resolveMaxWidthHeight(maxWidthHeight),
        jpegHandling: jpegHandling ?? "compress",
        pngHandling: pngHandling ?? "optimize",
        quality: quality ?? defaultQuality(),
        conversionQuality: conversionQuality ?? DEFAULT_CONVERSION_QUALITY
    };
}

/**
 * The bound to measure images against, validated and filled in. Shared with the inventory, so what
 * it reports as oversized is oversized by exactly the rule a run would apply.
 */
export function resolveMaxWidthHeight(maxWidthHeight: number | undefined): number {
    if (maxWidthHeight === undefined) {
        return defaultMaxWidthHeight();
    }

    if (!Number.isInteger(maxWidthHeight) || maxWidthHeight < MIN_MAX_WIDTH_HEIGHT) {
        throw new ValidationError(`maxWidthHeight must be an integer of ${MIN_MAX_WIDTH_HEIGHT} or above.`);
    }

    return maxWidthHeight;
}

function requireBoolean(value: unknown, name: string) {
    if (value !== undefined && typeof value !== "boolean") {
        throw new ValidationError(`${name} must be a boolean.`);
    }
}

function requireOneOf<T extends string>(value: T | undefined, allowed: readonly T[], name: string) {
    if (value !== undefined && !allowed.includes(value)) {
        throw new ValidationError(`${name} must be one of: ${allowed.join(", ")}.`);
    }
}

function requireQuality(value: number | undefined, name: string) {
    if (value !== undefined && (!Number.isInteger(value) || value < MIN_QUALITY || value > MAX_QUALITY)) {
        throw new ValidationError(`${name} must be an integer between ${MIN_QUALITY} and ${MAX_QUALITY}.`);
    }
}

/**
 * Whether the run descends into the note's subtree. Read apart from {@link resolveCompressionRequest}
 * because it says nothing about how an image is compressed, only about which images are visited —
 * so the provider never sees it. The attachment endpoint has no use for it and does not read it.
 */
export function resolveRecursive(options: ImageCompressionOptions = {}): boolean {
    requireBoolean(options.recursive, "recursive");

    return options.recursive === true;
}

/**
 * The bound a request that named none opens on: whatever the automatic shrinking is set to, so an
 * unqualified request compresses the way an import would.
 *
 * Read defensively, exactly as {@link defaultQuality} reads its own option. A stored setting is not
 * a validated one — it arrives by synchronisation from another instance, or from a database edited
 * by hand — and neither a value that is not a number nor one at or below zero can be resized to.
 * The first would abort the request where it was read; the second would reach the encoder as an
 * instruction to scale every image to nothing.
 */
function defaultMaxWidthHeight(): number {
    const configured = optionService.getOptionInt("imageMaxWidthHeight", 0);

    return configured >= MIN_MAX_WIDTH_HEIGHT ? configured : FALLBACK_MAX_WIDTH_HEIGHT;
}

/** What the option ships as, and so what an unusable stored value falls back to. */
const FALLBACK_MAX_WIDTH_HEIGHT = 2000;

function defaultQuality(): number {
    return storedQuality("imageJpegQuality");
}

function storedQuality(name: "imageJpegQuality" | "imageConversionQuality"): number {
    const configured = optionService.getOptionInt(name, 0);

    return configured >= MIN_QUALITY && configured <= MAX_QUALITY ? configured : DEFAULT_QUALITY;
}

/**
 * What automatic shrinking is set to do to an image on its way in — the same request the tool sends,
 * read from the image options instead of from a dialog.
 *
 * This is what puts uploads, pastes and imports on the compression the tool uses: PNGs quantized
 * rather than only ever turned into JPEGs, a JPEG already written at the target quality left alone
 * instead of squeezed again on every upload, and the decode run off-thread where there is a worker
 * for it. Before this, the automatic path had a resizer of its own that did none of that.
 *
 * Read as defensively as the two readers above, and for the same reason: a stored setting is not a
 * validated one. It arrives by synchronisation from another instance, or from a database edited by
 * hand, and a value that cannot be acted on falls back to what the option ships as. Nothing here
 * throws — this runs on the way into an upload, where refusing the settings would mean refusing the
 * image.
 */
export function automaticCompressionRequest(): ImageCompressionRequest {
    return {
        resize: optionService.getOptionBool("imageResize"),
        maxWidthHeight: defaultMaxWidthHeight(),
        jpegHandling: storedHandling("imageJpegHandling", IMAGE_JPEG_HANDLINGS, "compress"),
        pngHandling: storedHandling("imagePngHandling", IMAGE_PNG_HANDLINGS, "optimize"),
        quality: defaultQuality(),
        conversionQuality: storedQuality("imageConversionQuality")
    };
}

function storedHandling<T extends string>(
    name: "imageJpegHandling" | "imagePngHandling",
    allowed: readonly T[],
    fallback: T
): T {
    const configured = optionService.getOption(name);

    return allowed.includes(configured as T) ? (configured as T) : fallback;
}

/** What an image weighs, and enough of its front to say what it is. */
export interface TargetPeek {
    /** The stored image's size in bytes — the whole of it, not of {@link header}. */
    size: number;
    header: Uint8Array;
}

/**
 * How much of an image is read to identify it.
 *
 * A PNG states its dimensions within the first thirty-odd bytes, but a JPEG states them after
 * whatever metadata precedes them, and a camera's EXIF thumbnail or an embedded colour profile can
 * run to tens of kilobytes. This is picked to clear those: past it the reading simply comes back
 * without dimensions, and the image is read in full as it was before — slower, never wrong.
 */
export const HEADER_BYTES = 64 * 1024;

/**
 * One image the run can act on, hiding whether it lives in a note's content or in an attachment.
 *
 * Neither kind is renamed when its format changes: an attachment's title is a reference elsewhere
 * (a canvas addresses its images by the Excalidraw file id stored as the title), so the mime is
 * left to carry the format on its own.
 *
 * That makes the mime load-bearing rather than merely informative, since it is then the only
 * record of what the bytes are: download and export filenames both derive their extension from it
 * where the title disagrees, which is the whole reason they may be left disagreeing.
 */
export interface CompressionTarget {
    entityType: "note" | "attachment";
    entityId: string;
    title: string;
    mime: string;
    /** Set when the target must be left alone for a reason known before reading its content. */
    skip?: ImageCompressionSkipReason;
    getContent(): Uint8Array;
    /**
     * The image's size and its opening bytes, taken from the database without loading the rest.
     *
     * What decides an image's fate is almost entirely in its header, and reading a whole photograph
     * to look at thirty bytes of it is most of what a run over a large tree spends its time on.
     *
     * Null where the bytes in the database are not the bytes of the image — protected content is
     * stored encrypted, and a header read off the ciphertext describes nothing. The caller falls
     * back to reading it in full, which is what decrypts it.
     */
    peek(): TargetPeek | null;
    /** Names the content {@link getContent} returns — a hash of those exact bytes. */
    blobId(): string | undefined;
    /**
     * Writes the compressed image back, but only over the content it was derived from: re-encoding
     * is slow enough for the image to be replaced meanwhile, and this result describes the picture
     * that was there before. Answers whether the write happened.
     */
    save(buffer: Uint8Array, mime: string, sourceBlobId: string | undefined): boolean;
}

/**
 * The images the run will visit, in the order it visits them.
 *
 * Child notes are followed only when asked for: a descendant can be a clone shared with other
 * notes, so reaching into the subtree degrades images the caller may not have had in mind.
 * `getSubtree` visits each note once however many placements it has, leaves the hidden subtree out
 * and does not resolve search notes — the run follows the tree, not what a query happens to match.
 */
export function collectNoteTargets(note: BNote, recursive: boolean): CompressionTarget[] {
    return collectNoteImages(note, recursive).targets;
}

/**
 * The same images, with the notes they were gathered from — for a caller that has to say how far
 * the reading reached. One walk answers both; asking the subtree twice would not.
 */
export function collectNoteImages(note: BNote, recursive: boolean): { notes: BNote[]; targets: CompressionTarget[] } {
    const notes = recursive ? note.getSubtree().notes : [ note ];
    // An image note *is* its image and stands alone, so it is never asked what it has attached.
    const attachments = imageAttachmentsOf(notes.filter((candidate) => candidate.type !== "image"));

    // Note by note, in the order the subtree gave them, each note's own images in position order —
    // the order a run reports on and the user reads back.
    const targets = notes.flatMap((candidate) => candidate.type === "image"
        ? [ noteTarget(candidate) ]
        : (attachments.get(candidate.noteId) ?? []).map((attachment) => attachmentTarget(attachment)));

    return { notes, targets };
}

/**
 * Every image attachment the given notes own, gathered in one query and grouped by owner.
 *
 * Asked note by note this was a round trip each: cheap on its own, and ten thousand of them for a
 * subtree of that many notes. Once the images themselves stopped being read to decide their fate,
 * that was most of what collecting them cost.
 */
function imageAttachmentsOf(notes: BNote[]): Map<string, BAttachment[]> {
    const byOwner = new Map<string, BAttachment[]>();

    if (!notes.length) {
        return byOwner;
    }

    const sql = getSql();
    // Through the parameter table rather than an `IN` list: a subtree runs to more note ids than a
    // statement is allowed parameters, and this is how the rest of core asks the same kind of
    // question.
    sql.fillParamList(notes.map((candidate) => candidate.noteId));

    const rows = sql.getRows<AttachmentRow>(/*sql*/`
        SELECT attachments.*
        FROM attachments
        JOIN param_list ON param_list.paramId = attachments.ownerId
        WHERE attachments.role = 'image'
          AND attachments.isDeleted = 0
        ORDER BY attachments.ownerId, attachments.position`);

    for (const row of rows) {
        const owned = byOwner.get(row.ownerId);
        const attachment = new BAttachment(row);

        if (owned) {
            owned.push(attachment);
        } else {
            byOwner.set(row.ownerId, [ attachment ]);
        }
    }

    return byOwner;
}


function noteTarget(note: BNote): CompressionTarget {
    return {
        entityType: "note",
        entityId: note.noteId,
        title: note.title,
        mime: note.mime,
        skip: note.isContentAvailable() ? undefined : "protected",
        getContent: () => wrapStringOrBuffer(note.getContent()),
        peek: () => peekBlob(note.blobId, note.isProtected),
        blobId: () => note.blobId,
        save(buffer, mime, sourceBlobId) {
            const current = becca.getNote(note.noteId);

            if (!current || current.blobId !== sourceBlobId) {
                return false;
            }

            writeImage(current, buffer, mime);

            return true;
        }
    };
}

function attachmentTarget(attachment: BAttachment): CompressionTarget {
    const attachmentId = attachment.attachmentId ?? "";

    return {
        entityType: "attachment",
        entityId: attachmentId,
        title: attachment.title,
        mime: attachment.mime,
        skip: resolveAttachmentSkip(attachment),
        getContent: () => wrapStringOrBuffer(attachment.getContent()),
        peek: () => peekBlob(attachment.blobId, attachment.isProtected),
        blobId: () => attachment.blobId,
        // Written through a freshly read attachment rather than the one collected at the start of
        // the run: that one is a detached copy of its row, and `forceSave` writes the whole row
        // back, which would undo a title or position changed since — a subtree run is long.
        save(buffer, mime, sourceBlobId) {
            const current = becca.getAttachment(attachmentId);

            if (!current || current.blobId !== sourceBlobId) {
                return false;
            }

            writeImage(current, buffer, mime);

            return true;
        }
    };
}

/**
 * Writes the compressed image and the format it is now in, as one act.
 *
 * The format is set on the entity before the content because writing the content is what persists
 * the row — mime included — so there is nothing to save separately, and nothing at all reaches the
 * database until the new blob is in it.
 *
 * The failure is the reason this is a function rather than two lines. A write that throws is taken
 * back by the transaction around it, but the entity is a cached object that no rollback touches: it
 * would go on advertising a format whose bytes were never written, and hand that mime to whatever
 * saved the note next. So the field is put back by hand, the cache and the database ending up
 * agreeing either way.
 */
export interface WritableImage {
    mime: string;
    setContent(content: Uint8Array, opts: { forceSave: boolean }): void;
}

export function writeImage(entity: WritableImage, buffer: Uint8Array, mime: string) {
    const previousMime = entity.mime;

    entity.mime = mime;

    try {
            entity.setContent(buffer, { forceSave: true });
        } catch (e: unknown) {
            entity.mime = previousMime;

            throw e;
        }
    }

    /**
     * Reads an image's weight and its opening bytes straight out of the blob, leaving the body of it in
     * the database. One statement answers both, so the saving is a smaller read rather than a second
     * round trip.
     *
     * `CAST` on both: a blob column can hold text for other kinds of content, where `LENGTH` would
     * count characters and `substr` would cut on them. Bytes are what an image header is measured in.
     */
    function peekBlob(blobId: string | undefined, isProtected: boolean | undefined): TargetPeek | null {
        if (!blobId || isProtected) {
            return null;
        }

        const row = getSql().getRow<{ size: number | null; header: string | Uint8Array | null }>(/*sql*/`
            SELECT LENGTH(CAST(content AS BLOB)) AS size,
                   substr(CAST(content AS BLOB), 1, ?) AS header
            FROM blobs WHERE blobId = ?`, [ HEADER_BYTES, blobId ]);

        if (!row || row.size === null || row.header === null) {
            return null;
        }

        return { size: row.size, header: wrapStringOrBuffer(row.header) };
    }

    /**
     * A canvas, mermaid, mind map or spreadsheet note carries its rendered picture in an attachment of
     * a fixed title. Those are regenerated whenever the note is saved, so compressing one buys nothing
     * and lasts until the next save; worse, the route serving the spreadsheet's picture declares it
     * `image/png` unconditionally, so converting it to JPEG would serve bytes under the wrong type.
     */
    function resolveAttachmentSkip(attachment: BAttachment): ImageCompressionSkipReason | undefined {
        if (!attachment.isContentAvailable()) {
            return "protected";
        }

        const ownerNote = attachment.getNote();

        if (ownerNote && attachment.title === getImageAttachmentTitle(ownerNote.type)) {
            return "generated";
        }

        return undefined;
    }

    /**
     * Visits every image, in two passes.
     *
     * The first settles what it can from headers alone, which over a tree is most of the images there
     * are, and costs a small query each. What survives it has to be read and decoded, which is the
     * expensive part and the only part worth scheduling — so the second pass hands those to the budget,
     * each with what its decode is expected to want.
     *
     * The passes are not an optimization of each other: the first exists because deciding should not
     * cost what doing costs, the second because doing should not be allowed to cost everything at once.
     */
    async function compressTargets(
        targets: CompressionTarget[],
        request: ImageCompressionRequest,
        taskId?: string
    ): Promise<ImageCompressionResponse> {
        const concurrency = getImageProvider().compressionConcurrency();
        const reportProgress = progressReporter(taskId, targets.length);

        logRunStart(targets.length, concurrency);

        const stopped = () => taskId !== undefined && cancelledRuns.has(taskId);
        const items = new Array<ImageCompressionItem>(targets.length);
        const worthReading: { at: number; target: CompressionTarget; cost: number | null }[] = [];

        try {
        for (const [ at, target ] of targets.entries()) {
            if (stopped()) {
                items[at] = skippedItem(target, 0, "cancelled");
                reportProgress();
                continue;
            }

            const foreseen = await foreseeTarget(target, request);

            if (foreseen.item) {
                items[at] = foreseen.item;
                reportProgress();
            } else {
                worthReading.push({ at, target, cost: foreseen.cost });
            }
        }

        const writes = createWriteBatch();
        const compressed = await runWithinBudget(
            // A cancelled run still drains its queue, but each remaining image is answered rather than
            // worked on — the images go by in milliseconds and the scheduler needs no notion of any of
            // this.
            worthReading.map(({ target, cost }) => ({
                cost,
                run: () => (stopped()
                    ? Promise.resolve(skippedItem(target, 0, "cancelled"))
                    : compressTarget(target, request, writes)).finally(reportProgress)
            })),
            { totalBytes: COMPRESSION_BUDGET_BYTES, maxConcurrent: concurrency }
        );

        // Nothing should be left — every write either filled a group or waited out its own timer — but
        // saying so costs nothing and a run must not end holding work it has not committed.
        writes.flush();

        // Back into the order they were visited in, which is the order they are reported in — the
        // schedule above is free to have run them in any other.
        worthReading.forEach(({ at }, index) => {
            items[at] = compressed[index];
        });

        return logRunEnd(summarize(items));
    } finally {
        if (taskId !== undefined) {
            cancelledRuns.delete(taskId);
        }
    }
}

/**
 * Counts images off against the total, so a run of hundreds can say how far it has got rather than
 * only that it is going.
 *
 * Every image counts, whether it was compressed or settled from its header — the total is what the
 * run set out to visit, so the two have to agree or the count would stall short of its own end. The
 * effect is that a tree of mostly-untouched images races to a high number and then slows, which is
 * a fair picture of what is happening.
 *
 * A run nobody asked to watch is not reported on: without a task to report against, this is nothing.
 */
function progressReporter(taskId: string | undefined, total: number): () => void {
    if (!taskId) {
        return () => {};
    }

    const task = TaskContext.getInstance(taskId, "compressImages", null);

    task.setTotalCount(total);

    return () => task.increaseProgressCount();
}

/**
 * The most all decodes running at once may be holding between them.
 *
 * Conservative on purpose: this is a maintenance job running behind whatever the user is actually
 * doing, and a gigabyte is enough for one photograph of any size beside a good many screenshots.
 */
const COMPRESSION_BUDGET_BYTES = 1024 * 1024 * 1024;

/**
 * Announces a run before it begins, since it is otherwise silent until it ends: a subtree of
 * thousands is minutes of work whose only trace, until now, was the images it changed.
 *
 * Says what it is actually running on rather than a figure that reads as one — a single slot is
 * this thread doing the decoding, not a worker sitting somewhere. Nothing is announced for a note
 * holding no images at all; there is no operation to have started.
 */
function logRunStart(imageCount: number, concurrency: number) {
    if (imageCount === 0) {
        return;
    }

    const images = `${imageCount} image${imageCount === 1 ? "" : "s"}`;
    const how = concurrency > 1 ? `using ${concurrency} workers` : "on this thread";

    getLog().info(`Image Compression Tool: started operation over ${images} ${how}.`);
}

/**
 * Commits the run's writes in groups instead of one at a time.
 *
 * Every compressed image is a new blob written, an old one — often several megabytes — deleted, a
 * row updated and a change recorded. On its own that is a small transaction; eight hundred of them
 * back to back is gigabytes of pages through the write-ahead log, a commit and a flush each, and
 * the checkpoints that follow. None of that stops the process, which is what makes it confusing to
 * watch: the application keeps answering while the database it shares stops being available to
 * anything else, the note holding the log included.
 *
 * Grouping them changes none of the writing and almost all of the committing.
 *
 * Flushed when the group is full *or* when one has been waiting: without the second, the last few
 * images of a run would sit in a batch that never fills, and the run waits on them — which is a
 * deadlock rather than a delay.
 */
function createWriteBatch() {
    const pending: {
        write: () => boolean;
        settle: (saved: boolean) => void;
        fail: (error: unknown) => void;
    }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    function flush() {
        clearTimeout(timer);
        timer = undefined;

        const batch = pending.splice(0);

        if (batch.length === 0) {
            return;
        }

        try {
            // Each write answers for itself inside the one transaction: a single image that cannot
            // be written must not take the other twenty-four down with it, which is what letting
            // the exception out would do.
            // Given a context of its own, as every other write resumed after an asynchronous step
            // is: a flush runs from a timer, by which point the one the request was carrying is no
            // longer around it, and a transaction without one has no entity changes to record
            // against. `image.ts` does the same after its own processing completes.
            const outcomes = getContext().init(() => getSql().transactional(() => batch.map((entry) => {
                try {
                    return { saved: entry.write() };
                } catch (error: unknown) {
                    return { error };
                }
            })));

            batch.forEach((entry, at) => {
                const outcome = outcomes[at];

                if ("error" in outcome) {
                    entry.fail(outcome.error);
                } else {
                    entry.settle(outcome.saved);
                }
            });
        } catch (error: unknown) {
            // The transaction itself failed — not one write within it, but the whole thing, which
            // leaves every image in this group unanswered.
            //
            // Answering them is the entire point of catching it. A flush runs from a timer, so an
            // exception let out here goes nowhere anyone is watching, and the images waiting on it
            // wait for a promise that will never settle: the run stops, silently and permanently,
            // with its workers idle and nothing in the log to say why. Reporting the failure costs
            // those images and nothing else.
            getLog().error(`Image Compression Tool: a batch of ${batch.length} writes failed: ${error}`);
            batch.forEach((entry) => entry.fail(error));
        }
    }

    return {
        /** Queues a write and answers once it has been committed, with whatever it answered. */
        add(write: () => boolean): Promise<boolean> {
            return new Promise<boolean>((settle, fail) => {
                pending.push({ write, settle, fail });

                if (pending.length >= WRITE_BATCH_SIZE) {
                    flush();
                } else if (!timer) {
                    timer = setTimeout(flush, WRITE_BATCH_MS);
                }
            });
        },
        flush
    };
}

/** Enough to make the commits rare, few enough that a run is never far from having saved its work. */
const WRITE_BATCH_SIZE = 25;

/** How long a write waits for company before going on its own. */
const WRITE_BATCH_MS = 250;

/**
 * What is already known about a target before reading it: the finished item where its fate was
 * settled from the header, otherwise what its decode is expected to want.
 *
 * Nothing here is allowed to fail the run. A header that cannot be read, or a provider that cannot
 * answer for one, leaves the image to be read in full at an unknown cost — the slow path, which is
 * exactly what this pass is an optimization of, so falling back to it is always safe.
 */
async function foreseeTarget(target: CompressionTarget, request: ImageCompressionRequest): Promise<{
    item?: ImageCompressionItem;
    cost: number | null;
}> {
    const skipped = (originalSize: number, skipReason: ImageCompressionSkipReason) => ({
        item: skippedItem(target, originalSize, skipReason),
        cost: null
    });

    // Protected content cannot even be read without a session, so it is the one skip decided
    // without a size to report; every other one still reports what the image weighs.
    if (target.skip === "protected") {
        return skipped(0, "protected");
    }

    try {
        // The front of the image and what it weighs, without the body of it.
        const peeked = target.peek();

        if (target.skip) {
            return skipped(peeked?.size ?? target.getContent().byteLength, target.skip);
        }

        if (!peeked) {
            return { cost: null };
        }

        const plan = await getImageProvider().planCompression(peeked.header, request);

        return plan.skip ? skipped(peeked.size, plan.skip) : { cost: plan.decodeCost };
    } catch (e: unknown) {
        logFailure(target, e);

        // Not reported as a failure: nothing was attempted yet, and the read below may well succeed
        // where the glance at its header did not.
        return { cost: null };
    }
}

/**
 * Reads one image in full and compresses it. Reached only for images {@link foreseeTarget} could
 * not settle from the header, so the reading and the decoding are both known to be worth doing.
 */
async function compressTarget(
    target: CompressionTarget,
    request: ImageCompressionRequest,
    writes: ReturnType<typeof createWriteBatch>
): Promise<ImageCompressionItem> {
    const skipped = (originalSize: number, skipReason: ImageCompressionSkipReason) =>
        skippedItem(target, originalSize, skipReason);

    // One image failing is reported as that image's own skip and nothing more: the images after it
    // in the same run are still worth compressing.
    let content: Uint8Array | undefined;
    const startedAt = Date.now();

    try {
        content = target.getContent();
        // Read in the same turn as the content itself, so it names exactly the bytes just read.
        const sourceBlobId = target.blobId();

        const outcome = await getImageProvider().compressImage(content, request);

        if (!outcome.compressed) {
            return skipped(content.byteLength, outcome.reason);
        }

        // Queued rather than written here and now: the compression was asynchronous, so this is a
        // transaction of its own either way, and one shared with the images finishing around it
        // costs the database a fraction of what eight hundred separate commits do.
        //
        // The wait is long enough for the image to have been replaced meanwhile — by another
        // request, or by an incoming synchronisation update — and these bytes are a smaller copy of
        // the picture that replacement got rid of. Nothing here is worth putting that back, so the
        // newer image wins and this one is reported as skipped. The check happens inside the
        // transaction, whichever group it lands in.
        const saved = await writes.add(() => target.save(outcome.buffer, outcome.format.mime, sourceBlobId));

        if (!saved) {
            getLog().info(
                `Left ${target.entityType} '${target.entityId}' alone: its content changed while it was being compressed.`
            );

            return skipped(content.byteLength, "changed");
        }

        // The elapsed time rides on the line that was being written anyway. Per-image timing is the
        // first thing wanted when a run is slower than it should be, and asking for it separately
        // meant either a second line an image — which is what made the log a burden — or a setting
        // nobody has turned on at the moment they need it. This covers the whole of an image's
        // handling: reading it, compressing it, and waiting for its write to be committed.
        getLog().info(
            `Compressed ${target.entityType} '${target.entityId}' from ${content.byteLength} to `
            + `${outcome.buffer.byteLength} bytes in ${Date.now() - startedAt}ms.`
        );

        return {
            entityType: target.entityType,
            entityId: target.entityId,
            title: target.title,
            mime: outcome.format.mime,
            originalSize: content.byteLength,
            newSize: outcome.buffer.byteLength,
            compressed: true
        };
    } catch (e: unknown) {
        logFailure(target, e);
        return skipped(content?.byteLength ?? 0, "error");
    }
}

/**
 * An image the run visited and left as it was. Weighed the same on both sides, so a skipped image
 * contributes nothing to what the run reports as saved while still being counted as visited.
 */
function skippedItem(
    target: CompressionTarget,
    originalSize: number,
    skipReason: ImageCompressionSkipReason
): ImageCompressionItem {
    return {
        entityType: target.entityType,
        entityId: target.entityId,
        title: target.title,
        mime: target.mime,
        originalSize,
        newSize: originalSize,
        compressed: false,
        skipReason
    };
}

function logFailure(target: CompressionTarget, e: unknown) {
    const error = e as Error;

    getLog().error(`Failed to compress ${target.entityType} '${target.entityId}': ${error?.stack ?? error}`);
}

/**
 * Says how a run ended, which until now nothing did.
 *
 * A run that finished and a run that stopped part-way looked exactly alike in the log: images going
 * by, and then no more lines. Saying so plainly is the difference between "it is still working" and
 * "it is done" — and the tally of what was left alone is usually the answer to why so few images
 * were touched at all.
 */
function logRunEnd(response: ImageCompressionResponse): ImageCompressionResponse {
    if (response.items.length > 0) {
        const reasons = new Map<string, number>();

        response.items.filter((item) => !item.compressed).forEach((item) => {
            const reason = item.skipReason ?? "unknown";

            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        });

        const left = [ ...reasons ].map(([ reason, count ]) => `${count} ${reason}`).join(", ");

        getLog().info(
            `Image Compression Tool: finished — ${response.compressedCount} compressed, `
            + `${response.skippedCount} left alone${left ? ` (${left})` : ""}, `
            + `${response.savedSize} bytes saved.`);
    }

    return response;
}

function summarize(items: ImageCompressionItem[]): ImageCompressionResponse {
    const originalSize = items.reduce((total, item) => total + item.originalSize, 0);
    const newSize = items.reduce((total, item) => total + item.newSize, 0);

    return {
        items,
        compressedCount: items.filter((item) => item.compressed).length,
        skippedCount: items.filter((item) => !item.compressed).length,
        originalSize,
        newSize,
        savedSize: originalSize - newSize
    };
}

export default {
    automaticCompressionRequest,
    compressNoteImages,
    compressAttachmentImage,
    cancelImageCompression,
    resolveCompressionRequest,
    resolveRecursive
};
