/**
 * Standalone image provider implementation.
 * Uses pure JavaScript for format detection without compression.
 * Images are saved as-is without resizing.
 */

import type { ImageProvider, ImageFormat, ProcessedImage } from "@triliumnext/core";

/**
 * Detect image type from buffer using magic bytes.
 */
function getImageTypeFromBuffer(buffer: Uint8Array): ImageFormat | null {
    if (buffer.length < 12) {
        return null;
    }

    // Check for SVG (text-based)
    if (isSvg(buffer)) {
        return { ext: "svg", mime: "image/svg+xml" };
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { ext: "jpg", mime: "image/jpeg" };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return { ext: "png", mime: "image/png" };
    }

    // GIF: "GIF"
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return { ext: "gif", mime: "image/gif" };
    }

    // WebP: RIFF....WEBP
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return { ext: "webp", mime: "image/webp" };
    }

    // BMP: "BM"
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return { ext: "bmp", mime: "image/bmp" };
    }

    return null;
}

/**
 * Check if buffer contains SVG content.
 */
function isSvg(buffer: Uint8Array): boolean {
    const maxBytes = Math.min(buffer.length, 1000);
    let str = "";
    for (let i = 0; i < maxBytes; i++) {
        str += String.fromCharCode(buffer[i]);
    }

    const trimmed = str.trim().toLowerCase();
    return trimmed.startsWith("<svg") || (trimmed.startsWith("<?xml") && trimmed.includes("<svg"));
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
    }
};
