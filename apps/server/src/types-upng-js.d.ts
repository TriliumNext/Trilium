/**
 * Minimal declarations for `upng-js`, which ships none of its own.
 *
 * Only the encoder is declared, that being all this codebase uses: Jimp already decodes and
 * resizes, and UPNG is reached for solely to write the PNG back out (see `image_provider.ts`).
 * Add to this if a decoding path ever needs it.
 */
declare module "upng-js" {

    /**
     * Encodes RGBA frames as a PNG.
     *
     * @param frames one tightly-packed RGBA8 `ArrayBuffer` per frame; a single-entry array for a
     *               still image, more than one producing an APNG.
     * @param width in pixels.
     * @param height in pixels.
     * @param colors size of the palette to quantize to, 1 to 256. **Zero encodes losslessly**,
     *               keeping every colour and saving only what a better deflate can.
     * @param delays per-frame delays in milliseconds; APNG only.
     * @returns the encoded PNG.
     */
    export function encode(
        frames: ArrayBuffer[],
        width: number,
        height: number,
        colors: number,
        delays?: number[]
    ): ArrayBuffer;

}
