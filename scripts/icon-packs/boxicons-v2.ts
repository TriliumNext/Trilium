import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import iconList from "../../apps/client/src/widgets/icon_list";

function readMappingsFromCss() {
    const cssPath = join(__dirname, "../../node_modules/boxicons/css/boxicons.css");
    const cssContent = readFileSync(cssPath, "utf-8");
    const mappings: Record<string, string> = {};
    const regex = /\.(bx.*?):before.*?\n.*?content:.*?"(.*?)"/g;
    let match;
    while ((match = regex.exec(cssContent)) !== null) {
        mappings[match[1]] = String.fromCharCode(parseInt(match[2].substring(1), 16));
    }
    return mappings;
}

const mappings = readMappingsFromCss();

const icons = {};
for (const icon of iconList.icons) {
    if (!icon.className) continue;
    const className = icon.className.substring(3); // remove 'bx-' prefix
    if (className === "bx-empty") continue;

    icons[className] = {
        glyph: mappings[className],
        terms: [ icon.name, ...(icon.term || []) ]
    };
}

const manifest = {
    prefix: "bx",
    icons
};

writeFileSync(join(__dirname, "../../apps/server/src/services/icon_pack_boxicons-v2.json"), JSON.stringify(manifest, null, 2));
