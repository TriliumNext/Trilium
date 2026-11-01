import "./image_compression_summary.css";

import {
    IMAGE_COMPRESSIBLE_FORMATS,
    type ImageCompressibleFormat,
    type ImageInfoResponse,
    type ImageInventoryResponse
} from "@triliumnext/commons";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import { useDebouncedValue } from "../../react/hooks";
import { useFetch } from "../../react/use_fetch";
import { type ImageCompressionTarget, isSingleImage } from "./image_compression_operation";
import type { ImageCompressionToolOptions } from "./image_compression_options";

/**
 * What the dialog is about to act on, read before it acts and before it offers anything: the note
 * and what its images weigh, or the one image and what it is.
 *
 * A reading rather than a prediction — it says what is there, never what compressing would save.
 * The figures that depend on the settings (what counts as oversized, how far the run reaches) are
 * re-read as those settings change, so nothing on screen describes a run other than the one the
 * buttons would start.
 */
export interface CompressionReading {
    /** Present for a single image, and only then. */
    info: ImageInfoResponse | null;
    /** Present for a note, and only then. */
    inventory: ImageInventoryResponse | null;
    /** The reading did not arrive; nothing is known and nothing should be offered. */
    failed: boolean;
}

/**
 * Takes the one reading the dialog is built on. Which endpoint depends on the target, but the fetch
 * itself does not, so it is made unconditionally and sorted out afterwards.
 *
 * The bound trails the field being typed in: a number entered digit by digit should cost one
 * reading of the note rather than one per keystroke.
 */
export function useCompressionReading(
    target: ImageCompressionTarget,
    options: ImageCompressionToolOptions
): CompressionReading {
    const settledBound = useDebouncedValue(options.maxWidthHeight, READING_DEBOUNCE_MS);
    const single = isSingleImage(target);
    const { data, failed } = useFetch<ImageInfoResponse | ImageInventoryResponse>(
        single ? imageInfoUrl(target) : inventoryUrl(target, options.processChildNotes, settledBound)
    );

    return {
        info: single ? data as ImageInfoResponse | null : null,
        inventory: single ? null : data as ImageInventoryResponse | null,
        failed
    };
}

/**
 * Which formats there are actually images of to act on — the whole basis of what is offered.
 *
 * Read from the content in both cases, never from the mime an entity is filed under. Those
 * disagree often enough to matter: an image note Trilium saved itself carries `image/jpg`, which is
 * not a real mime type at all, and a dialog trusting it would tell the user their JPEG was a format
 * it could not compress.
 */
export function readableFormats(target: ImageCompressionTarget, reading: CompressionReading): ImageCompressibleFormat[] {
    if (isSingleImage(target)) {
        const format = reading.info?.format;

        return reading.info?.compressible && isCompressible(format) ? [ format ] : [];
    }

    return reading.inventory?.compressibleFormats ?? [];
}

function isCompressible(format: string | undefined): format is ImageCompressibleFormat {
    return (IMAGE_COMPRESSIBLE_FORMATS as readonly string[]).includes(format ?? "");
}

function imageInfoUrl(target: ImageCompressionTarget): string {
    return target.type === "note"
        ? `notes/${target.noteId}/image-info`
        : `attachments/${target.attachmentId}/image-info`;
}

function inventoryUrl(target: ImageCompressionTarget, recursive: boolean, maxWidthHeight: number): string {
    const noteId = target.type === "note" ? target.noteId : "";

    return `notes/${noteId}/image-inventory?recursive=${recursive}&maxWidthHeight=${maxWidthHeight}`;
}

/** Renders the reading; taking it is the dialog's, since what it offers depends on the answer. */
export function ImageCompressionSummary({ reading, recursive }: {
    reading: CompressionReading;
    recursive: boolean;
}) {
    const { info, inventory, failed } = reading;

    if (info) {
        return (
            <div className="image-compression-summary">
                <div className="image-compression-summary-title">{info.title}</div>
                <div>
                    {t("space_usage.compress_info_file", {
                        format: formatLabel(info.format), size: formatSize(info.size)
                    })}
                </div>
                <div className="image-compression-summary-detail">{describeImage(info)}</div>
            </div>
        );
    }

    if (!inventory) {
        return <SummaryPlaceholder failed={failed} />;
    }

    return (
        <div className="image-compression-summary">
            <div className="image-compression-summary-title">{describeScope(inventory, recursive)}</div>
            {inventory.total.count === 0
                ? <div>{t("space_usage.compress_summary_none")}</div>
                : <>
                    <div>
                        {t("space_usage.compress_summary_total", {
                            count: inventory.total.count, size: formatSize(inventory.total.size)
                        })}
                    </div>
                    <div className="image-compression-summary-detail">{describeBreakdown(inventory)}</div>
                </>}
        </div>
    );
}

/** Says which reading is still coming, or that it did not arrive; never a figure standing in. */
function SummaryPlaceholder({ failed }: { failed: boolean }) {
    return (
        <div className="image-compression-summary">
            <div className="image-compression-summary-detail">
                {t(failed ? "space_usage.compress_summary_failed" : "space_usage.compress_summary_reading")}
            </div>
        </div>
    );
}

/** The note, and how far past it the reading went — said only when it went anywhere. */
function describeScope(data: ImageInventoryResponse, recursive: boolean): string {
    const descendants = data.noteCount - 1;

    return recursive && descendants > 0
        ? t("space_usage.compress_summary_scope", { title: data.title, count: descendants })
        : data.title;
}

/**
 * The breakdown, as one sentence of clauses: what each format weighs, then the two figures the
 * settings above are about. Clauses that would say nothing are left out rather than printed as
 * zeroes — an unreadable image is worth mentioning, none of them is not.
 */
function describeBreakdown(data: ImageInventoryResponse): string {
    const clauses = data.formats.map((entry) => t("space_usage.compress_summary_format", {
        count: entry.count, format: formatLabel(entry.format), size: formatSize(entry.size)
    }));

    clauses.push(t("space_usage.compress_summary_oversized", {
        count: data.oversized.count, bound: data.maxWidthHeight
    }));
    clauses.push(t("space_usage.compress_summary_compressible", { count: data.compressible.count }));

    if (data.unreadable > 0) {
        clauses.push(t("space_usage.compress_summary_unreadable", { count: data.unreadable }));
    }

    return `${clauses.join(", ")}.`;
}

/**
 * What the image is, in the terms that decide what compressing it can do: its size, how its pixels
 * are stored, whether it carries transparency, and — for a JPEG — how hard it has been squeezed
 * already. Anything the header did not state is left out rather than guessed at.
 */
function describeImage(data: ImageInfoResponse): string {
    const clauses: string[] = [];

    if (data.width !== null && data.height !== null) {
        clauses.push(t("space_usage.compress_info_pixels", { width: data.width, height: data.height }));
    }

    if (data.bitDepth !== null && data.channels !== null) {
        clauses.push(t("space_usage.compress_info_bits", { bits: data.bitDepth * data.channels }));
    }

    if (data.hasAlpha) {
        clauses.push(t("space_usage.compress_info_transparency"));
    }

    if (data.quality !== null) {
        clauses.push(t("space_usage.compress_info_quality", { quality: data.quality }));
    }

    return clauses.join(", ");
}

/** How a format is named to a reader, rather than the extension the bytes were identified by. */
function formatLabel(format: string): string {
    if (format === "jpg") {
        return "JPEG";
    }

    return format === "unknown" ? t("space_usage.compress_format_unknown") : format.toUpperCase();
}

/** Long enough to type a four-digit bound through without re-reading the note between digits. */
const READING_DEBOUNCE_MS = 500;
