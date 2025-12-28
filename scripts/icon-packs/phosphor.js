import { join } from "node:path";
import { readFileSync } from "node:fs";

function processIconPack(packName, prefix) {
    const path = join(packName);
    const selectionMeta = JSON.parse(readFileSync(join(path, "selection.json"), "utf-8"));
    const icons = {};

    for (const icon of selectionMeta.icons) {
        let name = icon.properties.name;
        if (name.endsWith(`-${packName}`)) {
            name = name.split("-").slice(0, -1).join("-");
        }

        const id = `ph-${name}`;
        icons[id] = {
            glyph: `${String.fromCharCode(icon.properties.code)}`,
            terms: [ name ]
        };
    }

    return JSON.stringify({
        prefix,
        icons
    }, null, 2);
}

console.log(processIconPack("light", "ph-light"));