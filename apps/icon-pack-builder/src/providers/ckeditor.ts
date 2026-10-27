import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import * as ckeditorIcons from "@ckeditor/ckeditor5-icons";

import type { IconPackData } from "../provider";
import { buildSvgFont, type IconSource } from "../svg_font";
import { getModulePath } from "../utils";

const PREFIX = "cke";

/** Trilium's own editor icons, next to the plugins that use them. */
const TRILIUM_ICON_DIRS = [
    "src/icons",
    "src/plugins/ai_assistant/theme/icons",
    "src/plugins/snippets/theme/icons"
];

/**
 * Presentation attributes for the icons that CKEditor styles from its stylesheet instead of from
 * the SVG. Each value matches the rule the editor applies to that icon.
 */
const STYLESHEET_PRESENTATION: Record<string, string> = {
    // `.ck-widget__type-around__button svg *`
    IconReturnArrow: `fill="none" stroke="currentColor" stroke-width="1.5" `
        + `stroke-linecap="round" stroke-linejoin="round"`
};

/**
 * Builds a font out of the SVG icons of the text editor: those CKEditor 5 ships and those Trilium's
 * own plugins add. The User Guide uses them to name a toolbar button in running text.
 */
export default function buildIcons(): IconPackData {
    const { manifest, woff2 } = buildSvgFont("Trilium Text Editor Icons", PREFIX, collectSources());
    const packageJsonPath = join(getModulePath("@ckeditor/ckeditor5-icons"), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    return {
        name: "Text Editor Icons",
        prefix: PREFIX,
        icon: `${PREFIX} ${PREFIX}-pilcrow`,
        manifest,
        fontFile: {
            name: "text-editor-icons.woff2",
            mime: "font/woff2",
            content: woff2
        },
        meta: {
            version: packageJson.version,
            website: "https://ckeditor.com/docs/ckeditor5/latest/",
            description: "The icons of the text editor's toolbar: those of CKEditor 5 and those "
                + "Trilium adds, to name a button when documenting the editor."
        }
    };
}

/** The upstream icons first, then Trilium's under `cke-trilium-*`, which keeps the names apart. */
function collectSources(): IconSource[] {
    const sources: IconSource[] = [];

    for (const [ exportName, svg ] of Object.entries(ckeditorIcons)) {
        if (!exportName.startsWith("Icon") || typeof svg !== "string") continue;
        const presentation = STYLESHEET_PRESENTATION[exportName];
        sources.push({
            id: `${PREFIX}-${toKebabCase(exportName.slice("Icon".length))}`,
            svg: presentation ? svg.replace(/^<svg\b/, `<svg ${presentation}`) : svg
        });
    }

    const ckeditorPackageDir = join(__dirname, "../../../../packages/ckeditor5");
    for (const dir of TRILIUM_ICON_DIRS) {
        const fullDir = join(ckeditorPackageDir, dir);
        for (const file of readdirSync(fullDir).filter((f) => f.endsWith(".svg")).sort()) {
            const name = basename(file, ".svg");
            sources.push({
                id: name === "trilium" ? `${PREFIX}-trilium` : `${PREFIX}-trilium-${name}`,
                svg: readFileSync(join(fullDir, file), "utf-8")
            });
        }
    }

    return sources;
}

/** `AIAdjustLength` → `ai-adjust-length`, `Heading1` → `heading-1`. */
function toKebabCase(name: string) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
        .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
        .toLowerCase();
}
