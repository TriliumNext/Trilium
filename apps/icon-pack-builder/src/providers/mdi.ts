import { readFileSync } from "fs";
import { join } from "path";

import type { IconPackData } from "../provider";
import { extractClassNamesFromCss, getModulePath } from "../utils";

export default function buildIcons(): IconPackData {
    const baseDir = getModulePath("@mdi/font");

    const cssFilePath = join(baseDir, "css", "materialdesignicons.min.css");
    const cssFileContent = readFileSync(cssFilePath, "utf-8");

    return {
        name: "Material Design Icons",
        prefix: "mdi",
        icon: "mdi mdi-material-design",
        manifest: {
            icons: extractClassNamesFromCss(cssFileContent, "mdi"),
        },
        fontFile: {
            name: "materialdesignicons-webfont.woff2",
            mime: "font/woff2",
            content: readFileSync(join(baseDir, "fonts", "materialdesignicons-webfont.woff2"))
        }
    };
}
