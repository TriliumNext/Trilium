// gifenc ships no type definitions; minimal surface used by generate.mts.
declare module "gifenc" {
    export interface WriteFrameOptions {
        palette?: number[][];
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
        first?: boolean;
    }

    export interface GIFEncoderInstance {
        writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
        finish(): void;
        bytes(): Uint8Array;
    }

    const gifenc: {
        GIFEncoder(): GIFEncoderInstance;
        quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
        applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
    };
    export default gifenc;
}
