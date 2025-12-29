import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { IconPackData } from "../provider";
import { getModulePath } from "../utils";

export default function buildIcons(packName: "regular" | "fill"): IconPackData {
    const baseDir = join(getModulePath("@phosphor-icons/web"), "src", packName);
    const iconIndex = JSON.parse(readFileSync(join(baseDir, "selection.json"), "utf-8"));
    const icons: IconPackData["manifest"]["icons"] = {};

    function removeSuffix(name: string) {
        if (name.endsWith(`-${packName}`)) {
            name = name.split("-").slice(0, -1).join("-");
        }
        return name;
    }

    for (const icon of iconIndex.icons) {
        const terms = icon.properties.name.split(", ").map((t: string) => removeSuffix(t));
        const name = removeSuffix(icon.icon.tags[0]);

        const id = `ph-${name}`;
        icons[id] = {
            glyph: `${String.fromCharCode(icon.properties.code)}`,
            terms
        };
    }

    const fontFile = readdirSync(baseDir).find(f => f.endsWith(".woff2"));
    const prefix = packName === "regular" ? "ph" : `ph-${packName}`;

    return {
        name: `Phosphor Icons (${packName.charAt(0).toUpperCase() + packName.slice(1)})`,
        prefix,
        icon: `${prefix} ph-phosphor-logo`,
        manifest: {
            icons
        },
        fontFile: {
            name: fontFile!,
            mime: "font/woff2",
            content: readFileSync(join(baseDir, fontFile!))
        }
    };
}
