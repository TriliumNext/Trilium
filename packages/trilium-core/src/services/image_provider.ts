/**
 * Interface for platform-specific image processing.
 * Server uses JIMP with full compression support.
 * Standalone uses simple format detection without compression.
 */

import type { ImageCompressionSkipReason, ImageJpegHandling, ImagePngHandling } from "@triliumnext/commons";

export interface ImageFormat {
    ext: string;
    mime: string;
}

export interface ProcessedImage {
    buffer: Uint8Array;
    format: ImageFormat;
}

/**
 * A fully resolved {@link ImageCompressionOptions} — every fallback already applied, so a provider
 * never has to reach for an option itself.
 */
export interface ImageCompressionRequest {
    /** Whether an image larger than {@link maxWidthHeight} is scaled down to fit. */
    resize: boolean;
    /** Longest edge in pixels. Only consulted when {@link resize} is on. */
    maxWidthHeight: number;
    /** What becomes of an already-lossy image (JPEG): left as encoded, or recompressed. */
    jpegHandling: ImageJpegHandling;
    /** What becomes of a lossless image (PNG): left alone, quantized in place, or converted. */
    pngHandling: ImagePngHandling;
    /** JPEG quality, 10 to 100, for recompressing an already-lossy image. */
    quality: number;
    /** JPEG quality, 10 to 100, for converting a lossless image. */
    conversionQuality: number;
}

export type ImageCompressionOutcome =
    | { compressed: true; buffer: Uint8Array; format: ImageFormat }
    | { compressed: false; reason: ImageCompressionSkipReason };

export interface ImageProvider {
    /**
     * Detect image format from buffer.
     */
    getImageType(buffer: Uint8Array): ImageFormat | null;

    /**
     * Process image - may resize/compress depending on implementation.
     * @param buffer - Raw image data
     * @param originalName - Original filename for logging
     * @param shrink - Whether to attempt shrinking the image
     * @returns Processed image buffer and detected format
     */
    processImage(buffer: Uint8Array, originalName: string, shrink: boolean): Promise<ProcessedImage>;

    /**
     * Recompress an image the user has explicitly asked to shrink, ignoring the `compressImages`
     * option — that option governs automatic shrinking on import, and this is a deliberate act.
     *
     * Implementations decide nothing about *which* images to visit; they only answer for the one
     * buffer handed to them, and say why when they leave it alone. The buffer is returned only when
     * it genuinely came out smaller, so a caller can always replace the original with it.
     *
     * @param buffer - Raw image data
     * @param request - Fully resolved compression parameters
     */
    compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome>;

    /**
     * How many images this platform can usefully compress at once.
     *
     * One means "on the calling thread", which is not a limitation to work around: decoding is
     * synchronous, so without somewhere else to run it, more at once is the same work interleaved
     * and more memory held while it happens.
     */
    compressionConcurrency(): number;

    /**
     * Why an image with this header would be left alone, decided without the rest of it.
     *
     * The point is to answer for images a run will not touch without paying to read them: an
     * unsupported format, one already within the bound with nothing asked of its encoding, one too
     * large to decode. Over a tree those are most of the images there are, and the difference is
     * between reading a database's worth of pictures and reading the front of each.
     *
     * Answers only what the header settles. Anything it leaves open — dimensions past the end of
     * the given bytes, a question that needs the pixels — comes back `null`, meaning the image has
     * to be read in full and put through {@link compressImage}, which decides for itself either
     * way. A reason given here is therefore always one that would be given there.
     *
     * @param header - The opening bytes of the image; may be the whole of it.
     * @param request - Fully resolved compression parameters
     */
    planCompression(header: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionPlan>;

    /**
     * Scales a link preview's cover image down to `maxEdge` and re-encodes it, or declines.
     *
     * Separate from {@link compressImage} because the two want opposite things. Compression is
     * offered an image the user chose to keep and tries to make it cheaper without changing what it
     * is; this is handed someone else's `og:image` — up to 5MB of it — and wants a thumbnail nobody
     * will see above a couple of hundred pixels. Reusing the compression path would mean carrying
     * the full picture through a pipeline sized for the user's own photographs, to produce something
     * that is thrown away at the size this asks for anyway.
     *
     * Declining is a first-class answer, not a failure: a runtime with no decoder cannot do this at
     * all, and the caller has a perfectly good fallback — keep the original bytes when they are
     * small enough, and otherwise show the preview without a picture, which is what it does for an
     * image the decoder cannot read either way.
     */
    resizeForPreview(bytes: Uint8Array, request: PreviewResizeRequest): Promise<PreviewResizeOutcome>;
}

/** How a preview's cover image is to be reduced. */
export interface PreviewResizeRequest {
    /** Longest edge to scale down to. Never up: a small picture is left at the size it came. */
    maxEdge: number;
    /** Quality for the JPEG an opaque image becomes; one with real transparency becomes a PNG. */
    jpegQuality: number;
}

/** Bytes to store in place of the original, or the reason there are none. */
export type PreviewResizeOutcome =
    | { resized: true; bytes: Uint8Array }
    | { resized: false; reason: "undecodable" | "unsupported-platform" };

/** What a provider makes of an image from its header alone. */
export interface ImageCompressionPlan {
    /** Set when the image is to be left alone, and why; absent when it has to be read in full. */
    skip?: ImageCompressionSkipReason;
    /**
     * What decoding this is expected to want at its peak, in bytes, so a caller can decide how many
     * such decodes to have running at once. `null` where the header would not say — an unknown cost
     * is treated as the largest there is, rather than as a small one.
     *
     * A working figure for scheduling, not a limit to hold a decode to: it is what an ordinary image
     * of this size wants, and an unusually encoded one wants half as much again. What stops a decode
     * running away is the implementation's own ceiling, which does not move with this.
     *
     * Platform knowledge: what a decoder allocates is a fact about that decoder, which is why this
     * is answered here rather than estimated by the caller.
     */
    decodeCost: number | null;
}

let imageProvider: ImageProvider | null = null;

export function initImageProvider(provider: ImageProvider) {
    imageProvider = provider;
}

export function getImageProvider(): ImageProvider {
    if (!imageProvider) {
        throw new Error("Image provider not initialized");
    }
    return imageProvider;
}
