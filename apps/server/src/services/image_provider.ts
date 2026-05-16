/**
 * Server-side image provider implementation.
 * Uses JIMP for image processing with full compression support.
 */

import imageType from "image-type";
import isAnimated from "is-animated";
import isSvg from "is-svg";
import { Jimp } from "jimp";

import type { ImageProvider, ImageFormat, ProcessedImage } from "@triliumnext/core/src/services/image_provider.js";
import log from "./log.js";
import optionService from "./options.js";

async function getImageTypeFromBuffer(buffer: Uint8Array): Promise<ImageFormat | null> {
    // Check for SVG first (text-based)
    if (isSvg(Buffer.from(buffer).toString())) {
        return { ext: "svg", mime: "image/svg+xml" };
    }

    const detected = await imageType(buffer);
    if (detected) {
        return { ext: detected.ext, mime: detected.mime };
    }

    return null;
}

async function shrinkImage(buffer: Uint8Array, originalName: string): Promise<Uint8Array> {
    let jpegQuality = optionService.getOptionInt("imageJpegQuality", 0);

    if (jpegQuality < 10 || jpegQuality > 100) {
        jpegQuality = 75;
    }

    let finalImageBuffer: Uint8Array;
    try {
        finalImageBuffer = await resize(buffer, jpegQuality);
    } catch (e: unknown) {
        const error = e as Error;
        log.error(`Failed to resize image '${originalName}', stack: ${error.stack}`);
        finalImageBuffer = buffer;
    }

    // If resizing did not help with size, then save the original
    if (finalImageBuffer.byteLength >= buffer.byteLength) {
        finalImageBuffer = buffer;
    }

    return finalImageBuffer;
}

async function resize(buffer: Uint8Array, quality: number): Promise<Uint8Array> {
    const imageMaxWidthHeight = optionService.getOptionInt("imageMaxWidthHeight");

    const start = Date.now();

    const image = await Jimp.read(Buffer.from(buffer));

    if (image.bitmap.width > image.bitmap.height && image.bitmap.width > imageMaxWidthHeight) {
        image.resize({ w: imageMaxWidthHeight });
    } else if (image.bitmap.height > imageMaxWidthHeight) {
        image.resize({ h: imageMaxWidthHeight });
    }

    // When converting PNG to JPG, we lose the alpha channel - replace with white
    image.background = 0xffffffff;

    const resultBuffer = await image.getBuffer("image/jpeg", { quality });

    log.info(`Resizing image of ${resultBuffer.byteLength} took ${Date.now() - start}ms`);

    return resultBuffer;
}

export const serverImageProvider: ImageProvider = {
    getImageType(buffer: Uint8Array): ImageFormat | null {
        // Synchronous check for SVG
        if (isSvg(Buffer.from(buffer).toString())) {
            return { ext: "svg", mime: "image/svg+xml" };
        }

        // For other formats, we need async detection but interface is sync
        // Return null and let processImage handle the async detection
        return null;
    },

    async processImage(buffer: Uint8Array, originalName: string, shrink: boolean): Promise<ProcessedImage> {
        const compressImages = optionService.getOptionBool("compressImages");
        const origImageFormat = await getImageTypeFromBuffer(buffer);

        let shouldShrink = shrink;

        if (!origImageFormat || !["jpg", "png"].includes(origImageFormat.ext)) {
            shouldShrink = false;
        } else if (isAnimated(Buffer.from(buffer))) {
            // Recompression of animated images will make them static
            shouldShrink = false;
        }

        let finalBuffer: Uint8Array;
        let format: ImageFormat;

        if (compressImages && shouldShrink) {
            finalBuffer = await shrinkImage(buffer, originalName);
            format = (await getImageTypeFromBuffer(finalBuffer)) || { ext: "jpg", mime: "image/jpeg" };
        } else {
            finalBuffer = buffer;
            format = origImageFormat || { ext: "dat", mime: "application/octet-stream" };
        }

        return { buffer: finalBuffer, format };
    }
};
