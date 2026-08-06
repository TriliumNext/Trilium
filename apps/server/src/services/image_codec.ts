/**
 * The image codec: decoding, resizing and re-encoding, and the reasoning about whether any of that
 * is worth doing to a given image.
 *
 * Deliberately knows nothing about Trilium. No options, no logger, no database — what it is given
 * is bytes and what it answers is bytes, which is what lets the very same code run on this thread
 * and inside a worker without the worker having to stand up half a server to host it.
 *
 * Logging is passed in for the same reason: a worker has no logger of its own to reach for, and
 * lines it wants written have to travel back to the thread that has one.
 */

import { IMAGE_COMPRESSIBLE_FORMATS, type ImageCompressionSkipReason } from "@triliumnext/commons";
import { type InspectedImage, inspectImage } from "@triliumnext/core/src/services/image_inspect.js";
import type { ImageCompressionOutcome, ImageCompressionRequest, ImageFormat } from "@triliumnext/core/src/services/image_provider.js";
import { estimateJpegQuality } from "@triliumnext/core/src/services/jpeg_quality.js";
import imageType from "image-type";
import isAnimated from "is-animated";
import isSvg from "is-svg";
import { Jimp } from "jimp";
import * as UPNG from "upng-js";

/**
 * Where a line the codec wants written goes. Dropped by default, since nothing here needs it.
 *
 * `detail` marks a line that is worth having while investigating and not worth having otherwise —
 * one per image, which over a run is most of a log. The host decides what to do with that.
 */
export type CodecLog = (message: string, detail?: boolean) => void;

const IGNORE_LOG: CodecLog = () => {};

const JPEG_FORMAT: ImageFormat = { ext: "jpg", mime: "image/jpeg" };
const PNG_FORMAT: ImageFormat = { ext: "png", mime: "image/png" };

/** The only formats JIMP can both decode and re-encode here; everything else is left untouched. */
const COMPRESSIBLE_EXTENSIONS = new Set<string>(IMAGE_COMPRESSIBLE_FORMATS);

/**
 * What one JPEG decode may allocate.
 *
 * jpeg-js budgets 512 MB and refuses outright to decode anything needing more, which a photograph
 * off a modern camera or a flatbed scan exceeds on its own — and those are exactly the images worth
 * compressing, so the default withholds the feature precisely where it was wanted. A decode holds
 * the coefficient blocks, the per-component planes and the RGBA bitmap at once, on the order of a
 * dozen bytes per pixel, so this reaches into the tens of megapixels.
 *
 * Raised rather than lifted: it is still what stops a malformed header claiming a size no machine
 * has, and images are decoded one at a time, so this is the peak rather than a budget shared out.
 */
export const DECODE_MEMORY_MB = 1024;

/**
 * What a decode is taken to want, per pixel of the image — the most it might, not the usual.
 *
 * jpeg-js counts every allocation it makes and credits none of them back, so what it weighs against
 * its budget is the sum of all of them: the coefficient blocks it holds per component (4 bytes a
 * pixel each), the per-component planes (1 each), the interleaved component data (1 a component)
 * and the RGBA bitmap at the end (4). A photograph whose chroma is stored at quarter resolution
 * comes to about 15; one stored without any subsampling — which is what jimp itself writes — comes
 * to 22. This is the second figure, rounded up.
 *
 * Taking the usual case instead was a mistake worth recording. This governs two things: how many
 * decodes a caller will run at once, and how large an image is refused rather than attempted. Under-
 * counting made a sixty-megapixel image look like it would fit a gigabyte, so it was admitted,
 * reserved almost the whole budget, held every other image behind it for as long as the decode
 * took, and then had a fair chance of exceeding the decoder's own ceiling and failing anyway. A run
 * that stops dead on one enormous image is a far worse outcome than one that declines to touch it.
 */
const DECODE_BYTES_PER_PIXEL = 24;

export type CompressionPlan =
    | { verdict: "skip"; reason: ImageCompressionSkipReason }
    | { verdict: "proceed"; isLossless: boolean; worthReencoding: boolean; declared: InspectedImage };

/**
 * What is to become of an image, decided from as much of it as the caller had.
 *
 * Every question here is answered from the header, which is what lets the same reasoning serve a
 * run deciding whether an image is worth reading at all and the compression that follows once it
 * has been. Given only the front of a file it errs one way: a dimension it cannot reach leaves the
 * image to be read in full, never leaves it skipped on a reading that was never taken.
 */
export function planFromBytes(
    format: ImageFormat | null,
    bytes: Uint8Array,
    request: ImageCompressionRequest,
    log: CodecLog = IGNORE_LOG
): CompressionPlan {
    if (!format || !COMPRESSIBLE_EXTENSIONS.has(format.ext)) {
        return { verdict: "skip", reason: "unsupported-format" };
    }

    /* v8 ignore start -- the same rare defensive guard as in processImage above: spec-compliant
       animated images already fail the format gate (file-type reports animated PNG as "apng"
       and animated GIF/WebP as gif/webp). Only a pathological PNG with 512+ chunks before its
       acTL chunk reaches here, and recompressing it would keep the first frame alone. */
    if (isAnimated(asBuffer(bytes))) {
        return { verdict: "skip", reason: "animated" };
    }
    /* v8 ignore stop */

    const isLossless = format.ext === "png";

    // Whether re-encoding alone is worth doing to *this* image, each kind answering for itself:
    // a lossy source when its handling asks for it, a lossless one when its handling asks for
    // anything at all — rewriting a PNG as the same PNG at its own size gains nothing.
    //
    // A PNG's transparency does not enter into it, though it decides *which* re-encoding happens:
    // an image `jpeg` cannot take is quantized instead, so either way there is one to do. That is
    // what lets this be answered before the image is decoded.
    const worthReencoding = isLossless ? request.pngHandling !== "keep" : request.jpegHandling === "compress";

    // Read off the header rather than from the pixels: deciding whether anything is going to happen
    // to an image should not cost more than doing it. Dimensions the header does not give up — past
    // the end of a prefix, or behind metadata — leave this open, and the decode settles it.
    const declared = inspectImage(bytes);
    const declaredEdge = Math.max(declared.width ?? 0, declared.height ?? 0);
    const mayNeedResize = request.resize && (declaredEdge === 0 || declaredEdge > request.maxWidthHeight);

    if (!mayNeedResize && !worthReencoding) {
        return { verdict: "skip", reason: "no-gain" };
    }

    // What is left to do is a re-encoding, and a file can show that it has already had one.
    // Settled from the header rather than proven by decoding, which is what makes a second run
    // over the same tree cost a glance per image instead of a decode — and what stops those
    // re-encodings from shaving a little more quality off the same pixels on every run: writing
    // a JPEG back at the quality it already has usually saves a few bytes, so the size guard
    // after the decode never stops it.
    if (!mayNeedResize && alreadyReencoded(isLossless, bytes, declared, request)) {
        return { verdict: "skip", reason: "no-gain" };
    }

    if (exceedsDecodeCeiling(declared)) {
        log(`Image of ${declared.width}x${declared.height} is too large to decode; leaving it alone.`);

        return { verdict: "skip", reason: "too-large" };
    }

    return { verdict: "proceed", isLossless, worthReencoding, declared };
}

/**
 * Whether the one step left to do — re-encoding — has visibly already happened to this image.
 * Consulted only once resizing is off the table, so this is the whole of what remains.
 *
 * A JPEG carries the quality it was written at in its quantization table; at or below the target,
 * re-encoding buys nothing and costs a little of the picture, every time it is done. A PNG that
 * already stores a palette is what quantizing would produce. Conversion stays out of this: an
 * indexed PNG asked to become a JPEG can still come out smaller, so it is still worth attempting.
 *
 * Read from whatever bytes the caller had, and erring toward doing the work: a quality that cannot
 * be read — an unusual table, or one sitting past the end of a header prefix — answers false, and
 * the image is decoded exactly as before. The few points the estimate can be out by are accepted
 * the other way too: a re-encoding it forgoes was itself marginal.
 */
function alreadyReencoded(
    isLossless: boolean,
    bytes: Uint8Array,
    declared: InspectedImage,
    request: ImageCompressionRequest
): boolean {
    if (isLossless) {
        return request.pngHandling === "optimize" && declared.indexed === true;
    }

    const quality = estimateJpegQuality(bytes);

    return quality !== null && quality <= request.quality;
}

/**
 * Whether decoding this would want more than one decode is allowed.
 *
 * Applied to PNG as well, which has no budget of its own at all: pngjs decodes whatever it is given
 * until the process runs out of memory, and a ceiling refused here is the only guard it gets.
 *
 * A header that says nothing about its dimensions is not evidence of anything, so it is allowed
 * through: the decoder's own budget is still there to stop it, and refusing on a reading that was
 * never taken would withhold the feature from images that are perfectly ordinary.
 */
function exceedsDecodeCeiling(declared: InspectedImage): boolean {
    const cost = decodeCostOf(declared);

    return cost !== null && cost > DECODE_MEMORY_MB * 1024 * 1024;
}

/**
 * What decoding an image of this size is expected to want at its peak, in bytes.
 *
 * `null` where the header would not give up its dimensions, which the caller reads as "unknown and
 * therefore assume the worst" rather than as "free".
 */
export function decodeCostOf({ width, height }: InspectedImage): number | null {
    return width !== null && height !== null ? width * height * DECODE_BYTES_PER_PIXEL : null;
}

/**
 * Decodes an image, refusing to allocate more than it was allowed.
 *
 * The allowance is a parameter rather than a constant because a caller running several decodes at
 * once has already decided how much of the total each of them may have. Passing that same figure
 * down makes the reservation and its enforcement one number instead of two that can disagree.
 *
 * Not `Jimp.read`: it takes decode options in its signature and then calls `fromBuffer` without
 * them, so passing a memory budget there reads as correct and does nothing at all.
 */
export function decodeImage(buffer: Uint8Array, budgetMb: number = DECODE_MEMORY_MB) {
    return Jimp.fromBuffer(asBuffer(buffer), { "image/jpeg": { maxMemoryUsageInMB: budgetMb } });
}

/**
 * The same bytes as a `Buffer`, over the same memory.
 *
 * `Buffer.from(uint8Array)` duplicates what it is given, and the libraries below each want one —
 * so an image was being copied whole several times on its way through, for readers that only ever
 * read. On a run over a tree that is a second copy of every photograph in it, allocated and thrown
 * away again, which costs more in collection than the copying does outright.
 */
export function asBuffer(bytes: Uint8Array): Buffer {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** What {@link decodeImage} hands back, for the helpers that work on a decoded image. */
type DecodedImage = Awaited<ReturnType<typeof decodeImage>>;

/**
 * How large a palette the PNG quantizer may keep — deliberately the largest an indexed PNG can
 * hold, which makes this the gentlest lossy setting there is while still doing the work.
 *
 * The saving comes from storing one index per pixel rather than 24-bit colour, so a screenshot or
 * a diagram — what most PNGs in a note actually are — typically loses half its weight or better
 * with nothing visible to show for it. Going lower (64, 128) starts to band across gradients, and
 * encoding losslessly instead (0) rarely reaches a fifth. Neither extreme is the trade this tool
 * is for.
 */
const PNG_PALETTE_COLORS = 256;

/**
 * What the buffer holds, read from its bytes.
 *
 * The binary formats are asked first, being identifiable from the few bytes of a magic number. SVG
 * has none — it is text, and the only way to recognise it is to read it — so it is asked last, of
 * whatever nothing else claimed, and only once the opening bytes suggest markup at all.
 *
 * That order is the whole point. `isSvg` validates the document it is given, so it needs the file
 * as a string in full; building one out of a photograph costs hundreds of milliseconds an image and
 * answers "no" every time. Asked in this order, no image ever pays for it.
 */
export async function getImageTypeFromBuffer(buffer: Uint8Array): Promise<ImageFormat | null> {
    const detected = await imageType(buffer);

    if (detected) {
        return { ext: detected.ext, mime: detected.mime };
    }

    return detectSvg(buffer);
}

/**
 * SVG, or nothing. Guarded by a look at the opening bytes: `isSvg` takes a string, and turning a
 * buffer into one is the expensive part, so it is only worth doing for a buffer that begins the way
 * a document does.
 *
 * The guard is deliberately about the bytes rather than the content — anything opening with `<`,
 * declaration or comment or root element alike, goes through to `isSvg` and is judged there exactly
 * as it always was.
 */
export function detectSvg(buffer: Uint8Array): ImageFormat | null {
    if (!opensLikeMarkup(buffer) || !isSvg(asBuffer(buffer).toString())) {
        return null;
    }

    return { ext: "svg", mime: "image/svg+xml" };
}

/** How far in to look for the first meaningful character; a document declares itself well inside this. */
const MARKUP_PROBE_BYTES = 64;

function opensLikeMarkup(buffer: Uint8Array): boolean {
    // A byte-order mark, which an editor may have written ahead of the declaration.
    let index = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
    const limit = Math.min(buffer.byteLength, MARKUP_PROBE_BYTES);

    for (; index < limit; index++) {
        const byte = buffer[index];

        // Space, tab, line feed, carriage return: leading whitespace `isSvg` would trim anyway.
        if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
            continue;
        }

        return byte === 0x3c;
    }

    return false;
}
/**
 * Which quality a JPEG about to be written is owed. Converting a pristine original and recompressing
 * an already-lossy one are different trades, so each has a setting of its own.
 *
 * The third case has neither: a JPEG only being scaled, its handling left on `keep`. It has to be
 * re-encoded all the same — there is no way to write scaled pixels without one — so it goes out at
 * whatever quality it was already stored at, read off its own quantization table. Anything fixed
 * would be wrong in both directions: below the source it degrades an image nobody asked to degrade,
 * and above it the bytes-per-pixel rise can outweigh the pixels removed, leaving a modest resize
 * *larger* than it started and rejected by the size guard — the resize silently undone.
 */
function jpegQualityFor(request: ImageCompressionRequest, isLossless: boolean, source: Uint8Array): number {
    if (isLossless) {
        return request.conversionQuality;
    }

    if (request.jpegHandling === "compress") {
        return request.quality;
    }

    return estimateJpegQuality(source) ?? FALLBACK_RESIZE_QUALITY;
}

/**
 * Stands in when a JPEG's own quality cannot be read — an unusual table, or an encoder that scales
 * the standard one its own way. High enough that "keep" is not quietly made to mean "degrade",
 * accepting that a mild resize of a heavily compressed original may then not pay for itself.
 */
const FALLBACK_RESIZE_QUALITY = 92;

/**
 * Rewrites the image as a palette PNG, which is where a PNG's weight actually goes: the saving
 * comes from storing an index per pixel instead of 24-bit colour, not from discarding detail. The
 * alpha channel survives it, so this is the only step that can shrink a transparent image at all.
 *
 * @param originalByteLength the source file, for the ratio in the log line. After a resize the two
 *                           are not measuring the same picture, which is the reading that matters
 *                           anyway — how much smaller the stored image ends up.
 */
function quantizePng(image: DecodedImage, originalByteLength: number, log: CodecLog): Uint8Array {
    const start = Date.now();
    const { width, height, data } = image.bitmap;
    // A tightly packed copy: UPNG reads the whole ArrayBuffer, so a view carrying a byte offset or
    // slack past the pixels would be read as image data.
    const rgba = new Uint8Array(data);
    const encoded = new Uint8Array(UPNG.encode([ rgba.buffer ], width, height, PNG_PALETTE_COLORS));
    const saved = Math.round((1 - encoded.byteLength / originalByteLength) * 100);

    log(
        `PNG optimization of ${width}x${height} to ${PNG_PALETTE_COLORS} colors: `
        + `${originalByteLength} -> ${encoded.byteLength} bytes (${saved}% smaller) in ${Date.now() - start}ms`
    );

    return encoded;
}

/** True when any pixel is less than fully opaque, read off the decoded RGBA bitmap. */
function hasTransparency(image: DecodedImage): boolean {
    const { data } = image.bitmap;

    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
            return true;
        }
    }

    return false;
}


/**
 * Compresses one image, given all of its bytes.
 *
 * The plan is taken again here whatever a caller already decided from a header: this is the reading
 * that has the bytes the other one was missing, and the only one that can be acted on.
 */
export async function compressImageBytes(
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    log: CodecLog = IGNORE_LOG,
    budgetMb: number = DECODE_MEMORY_MB
): Promise<ImageCompressionOutcome> {
    const plan = planFromBytes(await getImageTypeFromBuffer(buffer), buffer, request, log);

    if (plan.verdict === "skip") {
        return { compressed: false, reason: plan.reason };
    }

    const { isLossless, worthReencoding } = plan;
    const start = Date.now();
    const image = await decodeImage(buffer, budgetMb);
    const { width, height } = image.bitmap;
    const needsResize = request.resize && Math.max(width, height) > request.maxWidthHeight;

    // Only consulted where it changes the answer. JPEG has no alpha channel, so a transparent
    // image cannot be converted — it is optimized instead, that being the best still available
    // to it. The check reads the decoded pixels, so it is exact rather than a guess from the
    // header, and it is skipped entirely where nothing is going to be converted anyway.
    const convertible = isLossless && request.pngHandling === "jpeg" && !hasTransparency(image);

    // What the image will be written back as. A JPEG can only ever be written back as one.
    const toJpeg = !isLossless || convertible;
    // A PNG that is staying a PNG is quantized unless it was to be left alone outright — which
    // covers both `optimize` and a transparent image that `jpeg` could not take.
    const quantize = isLossless && !toJpeg && request.pngHandling !== "keep";

    // Reached only where the header would not say how large the image was: everything else was
    // settled above without decoding.
    if (!needsResize && !worthReencoding) {
        return { compressed: false, reason: "no-gain" };
    }

    if (needsResize) {
        if (width >= height) {
            image.resize({ w: request.maxWidthHeight });
        } else {
            image.resize({ h: request.maxWidthHeight });
        }
    }

    let result: Uint8Array;

    if (toJpeg) {
        // Reached either by conversion, which has already established there is no transparency
        // to lose, or by a JPEG source, which never had any to begin with.
        image.background = 0xffffffff;
        result = await image.getBuffer("image/jpeg", { quality: jpegQualityFor(request, isLossless, buffer) });
    } else if (quantize) {
        result = quantizePng(image, buffer.byteLength, log);
    } else {
        result = await image.getBuffer("image/png");
    }

    // The pixels, not just the bytes: a well-compressed photograph can be a tenth the size of a
    // plain one and ten times the work, and without this the log gives no way to tell the two apart.
    log(`Compressing image of ${buffer.byteLength} bytes (${width}x${height}, `
        + `${(width * height / 1e6).toFixed(1)} MP) took ${Date.now() - start}ms`, true);

    if (result.byteLength >= buffer.byteLength) {
        // A small or already well-compressed image can grow; the original stays.
        return { compressed: false, reason: "no-gain" };
    }

    return { compressed: true, buffer: result, format: toJpeg ? JPEG_FORMAT : PNG_FORMAT };
}

