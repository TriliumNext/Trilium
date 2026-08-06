import { IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS, type ImageCompressibleFormat, type ImageJpegHandling, type ImagePngHandling } from "@triliumnext/commons";

/**
 * What the image compression tool is set to do. Persisted as JSON in the `imageCompressionToolOptions`
 * option, so the next run opens on the last answer rather than on a fresh set of defaults.
 *
 * All but the last mirror the server's `ImageCompressionOptions`; {@link processChildNotes} is the
 * tool's own, the endpoint acting on one note at a time.
 */
export interface ImageCompressionToolOptions {
    /** Whether an image larger than {@link maxWidthHeight} is scaled down to fit. */
    resize: boolean;
    /** Longest edge in pixels. Only consulted when {@link resize} is on. */
    maxWidthHeight: number;
    /** What becomes of an already-lossy image (JPEG): left as encoded, or recompressed. */
    jpegHandling: ImageJpegHandling;
    /** What becomes of a lossless image (PNG): left alone, quantized in place, or converted. */
    pngHandling: ImagePngHandling;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}, for an already-lossy image. */
    quality: number;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}, for converting a lossless one. */
    conversionQuality: number;
    /** Whether the note's whole subtree is compressed, rather than the note on its own. */
    processChildNotes: boolean;
}

/**
 * Whether the settings amount to anything, given the formats actually there to be acted on. Asking
 * for PNGs to be optimized says nothing about a note holding only JPEGs, and nothing asked of a
 * format that is not present is work.
 *
 * An empty list is therefore never work — which covers a reading still in flight as well as one
 * that found nothing, and in neither case is there a run worth offering yet.
 */
export function hasWorkToDo(options: ImageCompressionToolOptions, formats: ImageCompressibleFormat[]): boolean {
    return (options.resize && formats.length > 0)
        || (formats.includes("jpg") && options.jpegHandling !== "keep")
        || (formats.includes("png") && options.pngHandling !== "keep");
}

/** The bounds the server validates against; the controls here never offer a value it would reject. */
export const MIN_QUALITY = 10;
export const MAX_QUALITY = 100;
export const QUALITY_STEP = 5;
export const MIN_MAX_WIDTH_HEIGHT = 1;

/**
 * Fills a stored setting out into the full set the dialog works with.
 *
 * The tool keeps defaults of its own rather than deriving them from the image options: those govern
 * what happens to every image on the way in, where this is a deliberate one-off on an image that has
 * already grown too heavy, and the two are not the same judgement. What is stored always wins, so
 * these are only ever what the very first run opens on.
 *
 * Resizing and compressing start on, PNGs on being made smaller without ceasing to be PNGs — the
 * least surprising thing to do to each. Reaching into the subtree does not: that widens what the run
 * touches rather than how hard it compresses, and a descendant may be a clone shared with notes the
 * user did not have in mind.
 */
export function readImageCompressionOptions(
    stored: Partial<ImageCompressionToolOptions> | null | undefined,
    defaults: ImageCompressionDefaults = IMAGE_COMPRESSION_DEFAULTS
): ImageCompressionToolOptions {
    return {
        resize: stored?.resize ?? true,
        maxWidthHeight: isPositiveInteger(stored?.maxWidthHeight)
            ? Number(stored?.maxWidthHeight)
            : DEFAULT_MAX_WIDTH_HEIGHT,
        jpegHandling: readHandling(stored?.jpegHandling, IMAGE_JPEG_HANDLINGS, defaults.jpegHandling),
        pngHandling: readHandling(stored?.pngHandling, IMAGE_PNG_HANDLINGS, defaults.pngHandling),
        quality: isQuality(stored?.quality) ? Number(stored?.quality) : DEFAULT_QUALITY,
        conversionQuality: isQuality(stored?.conversionQuality)
            ? Number(stored?.conversionQuality)
            : DEFAULT_CONVERSION_QUALITY,
        processChildNotes: stored?.processChildNotes === true
    };
}

/**
 * What a host's first run opens on, for the two choices hosts genuinely differ on. Everything else
 * — the bound, the qualities — means the same wherever the rows are shown.
 */
export interface ImageCompressionDefaults {
    jpegHandling: ImageJpegHandling;
    pngHandling: ImagePngHandling;
}

/** The image compression dialog's own: act on both formats, since acting is what it was opened for. */
export const IMAGE_COMPRESSION_DEFAULTS: ImageCompressionDefaults = {
    jpegHandling: "compress",
    pngHandling: "optimize"
};

/**
 * Where the cleanup tool starts instead: scaling only, neither format re-encoded.
 *
 * It runs over every image in the database in one unattended pass, where the dialog is aimed at
 * images the user has just been looking at — so the same setting is a much larger bet here. Scaling
 * is the one step that is bounded by what it finds: an image already within the bound is left
 * exactly as it was, so a database of screenshots and diagrams comes through untouched. Re-encoding
 * is not bounded by anything and costs quality on every image it reaches, which is a choice to make
 * deliberately rather than one to find already ticked.
 */
export const CONSERVATIVE_IMAGE_COMPRESSION_DEFAULTS: ImageCompressionDefaults = {
    jpegHandling: "keep",
    pngHandling: "keep"
};

/**
 * What automatic compression falls back to: an arriving JPEG recompressed, an arriving PNG made
 * smaller without ceasing to be one.
 *
 * Only ever reached by a stored option that cannot be read, since every one of these settings has
 * a value from the moment the database is created. It is here so that the unreadable case answers
 * the way the server answers it — the settings page and the upload path must not disagree about
 * what an install with a corrupt option is doing.
 */
export const AUTOMATIC_IMAGE_COMPRESSION_DEFAULTS: ImageCompressionDefaults = {
    jpegHandling: "compress",
    pngHandling: "optimize"
};

/** The longest edge the first run offers to scale down to: the width of a Full HD screen. */
export const DEFAULT_MAX_WIDTH_HEIGHT = 1920;

/** Where recompressing an already-lossy image starts. */
export const DEFAULT_QUALITY = 75;

/**
 * Where converting starts, above {@link DEFAULT_QUALITY}: converting a lossless original gives up
 * detail that was genuinely there, where recompressing an already-lossy image works on detail that
 * is long gone.
 */
export const DEFAULT_CONVERSION_QUALITY = 85;

/** Anything unrecognised falls back to the default, rather than to whichever choice comes first. */
function readHandling<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? value as T : fallback;
}

function isPositiveInteger(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_MAX_WIDTH_HEIGHT;
}

function isQuality(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_QUALITY && Number(value) <= MAX_QUALITY;
}
