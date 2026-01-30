import { readFileSync } from "fs";
import { join } from "path";

import { IconPackData } from "../provider";

export default function buildIcons(pack: "basic" | "brands"): IconPackData {
    const inputDir = join(__dirname, "../../boxicons-free/fonts");
    const fileName = pack === "basic" ? "boxicons" : `boxicons-${pack}`;
    const jsonPath = `${inputDir}/${pack}/${fileName}.json`;
    const inputData = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const icons = {};

    for (const [ key, value ] of Object.entries(inputData)) {
        if (key.startsWith("variable-selector")) continue;

        let name = key;
        if (name.startsWith('bx-')) {
            name = name.slice(3);
        }
        if (name.startsWith('bxs-')) {
            name = name.slice(4);
        }
        icons[key] = {
            glyph: String.fromCodePoint(value as number),
            terms: [ name ]
        };
    }

    return {
        name: pack === "basic" ? "Boxicons 3 (Basic)" : "Boxicons 3 (Brands)",
        prefix: pack === "basic" ? "bx3" : "bxl3",
        icon: pack === "basic" ? "bx3 bx-cube" : "bxl3 bxl-boxicons",
        fontFile: {
            name: `${fileName}.woff2`,
            mime: "font/woff2",
            content: readFileSync(join(inputDir, pack, `${fileName}.woff2`))
        },
        manifest: {
            icons
        }
    };
}
