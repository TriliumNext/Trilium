/**
 * Standalone image provider implementation.
 * Uses pure JavaScript for format detection without compression.
 * Images are saved as-is without resizing.
 */

import type { ImageCompressionOutcome, ImageCompressionPlan, ImageFormat, ImageProvider, ProcessedImage } from "@triliumnext/core";
import { inspectImage, UNKNOWN_FORMAT } from "@triliumnext/core/src/services/image_inspect.js";

/**
 * Detect image type from buffer, delegating to the shared inspector so this runtime and the
 * inventory recognise exactly the same formats by exactly the same bytes.
 */
function getImageTypeFromBuffer(buffer: Uint8Array): ImageFormat | null {
    const { format, mime } = inspectImage(buffer);

    return format === UNKNOWN_FORMAT ? null : { ext: format, mime };
}

export const standaloneImageProvider: ImageProvider = {
    getImageType(buffer: Uint8Array): ImageFormat | null {
        return getImageTypeFromBuffer(buffer);
    },

    async processImage(buffer: Uint8Array, _originalName: string, _shrink: boolean): Promise<ProcessedImage> {
        // Standalone doesn't do compression - just detect format and return original
        const format = getImageTypeFromBuffer(buffer) || { ext: "dat", mime: "application/octet-stream" };

        return {
            buffer,
            format
        };
    },

    async compressImage(): Promise<ImageCompressionOutcome> {
        // No decoder here, so there is nothing to recompress with — the request is answered rather
        // than refused, and the caller reports the images as untouched along with the reason.
        return { compressed: false, reason: "unsupported-platform" };
    },

    compressionConcurrency(): number {
        // Nothing to compress with, so nothing to spread over threads.
        return 1;
    },

    async planCompression(): Promise<ImageCompressionPlan> {
        // Settled before an image is so much as weighed: nothing here is going to compress it
        // whatever its header says, so a run over a tree reads none of them.
        return { skip: "unsupported-platform", decodeCost: null };
    }
};
