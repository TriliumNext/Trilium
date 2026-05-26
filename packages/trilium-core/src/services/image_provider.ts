/**
 * Interface for platform-specific image processing.
 * Server uses JIMP with full compression support.
 * Standalone uses simple format detection without compression.
 */

export interface ImageFormat {
    ext: string;
    mime: string;
}

export interface ProcessedImage {
    buffer: Uint8Array;
    format: ImageFormat;
}

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
