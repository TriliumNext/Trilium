import fs from "fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface PngInfo {
    width: number;
    height: number;
    alpha: boolean;
    /** The file size in bytes. */
    size: number;
}

/** The size and alpha channel of a PNG, read from its header, or undefined when it is missing. */
export function readPng(file: string): PngInfo | undefined {
    if (!fs.existsSync(file)) return undefined;
    const buffer = fs.readFileSync(file);
    const colorType = buffer[25];
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        alpha: colorType === 4 || colorType === 6,
        size: buffer.length
    };
}

export function describePng(png: PngInfo | undefined) {
    if (!png) return "missing";
    const alpha = png.alpha ? "alpha" : "no alpha";
    return `${png.width} x ${png.height}, ${alpha}, ${Math.round(png.size / 1024)} KB`;
}

/** The share of pixels that differ between two screenshots of the same size. */
export function diffPngs(expectedFile: string, actualFile: string, diffFile: string) {
    const expected = PNG.sync.read(fs.readFileSync(expectedFile));
    const actual = PNG.sync.read(fs.readFileSync(actualFile));
    const { width, height } = expected;
    const diff = new PNG({ width, height });
    const count = pixelmatch(expected.data, actual.data, diff.data, width, height,
        { threshold: 0.1 });
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
    return count / (width * height);
}
