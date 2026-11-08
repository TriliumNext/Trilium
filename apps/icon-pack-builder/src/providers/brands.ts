import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { IconPackData } from "../provider";
import { buildSvgFont } from "../svg_font";

const PREFIX = "tn-brand";

/** One SVG per mark, named after the class it becomes: `openai.svg` → `tn-brand-openai`. */
const SOURCE_DIR = join(__dirname, "../../brand-icons");

/**
 * Builds a font out of the marks of the services Trilium works with: the AI providers and the
 * applications it imports from. The client shows them in monochrome, and the User Guide uses them
 * to name a provider in running text.
 */
export default function buildBrands(): IconPackData {
    const sources = readdirSync(SOURCE_DIR)
        .filter((file) => file.endsWith(".svg"))
        .sort()
        .map((file) => ({
            id: `${PREFIX}-${basename(file, ".svg")}`,
            svg: readFileSync(join(SOURCE_DIR, file), "utf-8")
        }));
    const { manifest, woff2 } = buildSvgFont("Trilium Brand Icons", PREFIX, sources);

    return {
        name: "Brand Icons",
        prefix: PREFIX,
        icon: `${PREFIX} ${PREFIX}-openai`,
        manifest,
        fontFile: {
            name: "brand-icons.woff2",
            mime: "font/woff2",
            content: woff2
        },
        meta: {
            version: "1.0.0",
            website: "https://github.com/TriliumNext/Trilium",
            description: "The marks of the AI providers and import sources Trilium works with."
        }
    };
}
