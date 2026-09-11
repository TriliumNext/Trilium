import { readFileSync } from "fs";
import { join } from "path";

import { measureIconFont } from "@triliumnext/commons";
import opentype from "opentype.js";

import { IconPackManifest } from "@triliumnext/core/src/services/icon_packs";

export function extractClassNamesFromCss(css: string, prefix: string): IconPackManifest["icons"] {
    const regex = /\.([a-zA-Z0-9-]+)::before\s*\{\s*content:\s*"\\([A-Fa-f0-9]+)"\s*\}/g;
    const icons: IconPackManifest["icons"] = {};
    let match: string[];

    while ((match = regex.exec(css)) !== null) {
        let name = match[1];
        if (prefix && name.startsWith(`${prefix}-`)) {
            name = name.substring(prefix.length + 1);
        }

        icons[match[1]] = {
            glyph: String.fromCodePoint(parseInt(match[2], 16)),
            terms: [ name ]
        };
    }
    return icons;
}

export function getModulePath(moduleName: string): string {
    return join(__dirname, "../../../node_modules", moduleName);
}

/**
 * The metrics of an icon font, read off its glyphs, for the pack's manifest to carry.
 *
 * Packs ship as WOFF2, which cannot be taken apart without a Brotli decoder, so this reads the
 * TrueType build every provider has beside it. The two hold the same outlines.
 *
 * @param fontPath the `.ttf` to measure.
 * @returns the metrics, or `undefined` where the font cannot be read.
 */
export function readIconFontMetrics(fontPath: string): IconPackManifest["metrics"] {
    let font;
    try {
        const bytes = readFileSync(fontPath);
        font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    } catch (e) {
        console.warn(`Could not read font metrics from ${fontPath}: ${e}`);
        return undefined;
    }

    const inkCentres: number[] = [];
    for (const glyph of Object.values(font.glyphs.glyphs)) {
        if (!glyph.unicode) continue;

        const box = glyph.getBoundingBox();
        // A blank glyph reports an inverted box, and says nothing about where the pack draws.
        if (box.y2 > box.y1) {
            inkCentres.push((box.y1 + box.y2) / 2);
        }
    }

    return measureIconFont(font.unitsPerEm, inkCentres) ?? undefined;
}
