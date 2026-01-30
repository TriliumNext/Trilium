import { join } from "path";

import { IconPackManifest } from "../../server/src/services/icon_packs";

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
