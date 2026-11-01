/**
 * What images a note holds, and how much of that compressing could reach.
 *
 * Answers the question the compression dialog cannot answer for itself — is this worth running, and
 * on how much — without running anything. The images counted are exactly those a run with the same
 * `recursive` setting would visit, because both come from the same {@link collectNoteTargets}: an
 * inventory that described a different set from the operation it precedes would be worse than none.
 *
 * Headers only, never a decode. Walking a subtree to identify and measure every image has to stay
 * far cheaper than compressing them, or nothing would open the dialog with it.
 */

import {
    IMAGE_COMPRESSIBLE_FORMATS,
    type ImageCompressibleFormat,
    type ImageInventoryFormat,
    type ImageInventoryResponse,
    type ImageInventoryTally
} from "@triliumnext/commons";

import becca from "../becca/becca.js";
import { NotFoundError } from "../errors.js";
import {
    collectNoteImages,
    type CompressionTarget,
    type TargetPeek,
    resolveMaxWidthHeight,
    resolveRecursive
} from "./image_compression.js";
import { inspectImage } from "./image_inspect.js";

export interface ImageInventoryOptions {
    /** Whether the note's whole subtree is counted, rather than the note on its own. */
    recursive?: boolean;
    /** The longest edge to measure against. Omitted, it falls back to the `imageMaxWidthHeight` option. */
    maxWidthHeight?: number;
}

export function getNoteImageInventory(noteId: string, options: ImageInventoryOptions = {}): ImageInventoryResponse {
    const note = becca.getNote(noteId);

    if (!note) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }

    const maxWidthHeight = resolveMaxWidthHeight(options.maxWidthHeight);
    const { notes, targets } = collectNoteImages(note, resolveRecursive(options));

    const total = emptyTally();
    const compressible = emptyTally();
    const oversized = emptyTally();
    const formats = new Map<string, ImageInventoryFormat>();
    const reachable = new Set<string>();
    let unreadable = 0;

    for (const target of targets) {
        const read = readHeader(target);

        if (!read) {
            unreadable++;
            continue;
        }

        const { format, width, height } = inspectImage(read.header);
        const size = read.size;

        add(total, size);
        add(tallyFor(formats, format), size);

        // Everything above counts what is *there*; from here down, only what a run would act on —
        // so a format nothing can compress, and a picture a note regenerates on save, are both out.
        if (target.skip || !(IMAGE_COMPRESSIBLE_FORMATS as readonly string[]).includes(format)) {
            continue;
        }

        add(compressible, size);
        reachable.add(format);

        if (width !== null && height !== null && Math.max(width, height) > maxWidthHeight) {
            add(oversized, size);
        }
    }

    // Heaviest first: what a note's images weigh is the reason to be looking at all.
    const ordered = [ ...formats.values() ].sort((a, b) => b.size - a.size);

    return {
        title: note.title,
        noteCount: notes.length,
        total,
        compressible,
        oversized,
        formats: ordered,
        compressibleFormats: ordered
            .map((entry) => entry.format)
            .filter((format): format is ImageCompressibleFormat => reachable.has(format)),
        maxWidthHeight,
        unreadable
    };
}

/**
 * What the image weighs and enough of it to identify, or `null` where neither can be had —
 * protected content with no session open, and any read that fails for a reason this has no use for.
 * Counting an image it could not measure would put a size of zero into the totals, which is worse
 * than saying it went unread.
 *
 * Everything this reports — the format, the dimensions, the weight — is in the front of the file or
 * in the database's own accounting, so the pictures themselves are left where they are. A note
 * holding a gigabyte of photographs is tallied without a gigabyte being read to do it.
 */
function readHeader(target: CompressionTarget): TargetPeek | null {
    if (target.skip === "protected") {
        return null;
    }

    try {
        // Protected content with a session open has no peek to give — the stored bytes are
        // encrypted — so it falls back to the read that decrypts them.
        const peeked = target.peek();

        if (peeked) {
            return peeked;
        }

        const content = target.getContent();

        return { size: content.byteLength, header: content };
    } catch {
        return null;
    }
}

function tallyFor(formats: Map<string, ImageInventoryFormat>, format: string): ImageInventoryFormat {
    const existing = formats.get(format);

    if (existing) {
        return existing;
    }

    const created = { format, count: 0, size: 0 };
    formats.set(format, created);

    return created;
}

function add(tally: ImageInventoryTally, size: number) {
    tally.count++;
    tally.size += size;
}

function emptyTally(): ImageInventoryTally {
    return { count: 0, size: 0 };
}

export default { getNoteImageInventory };
