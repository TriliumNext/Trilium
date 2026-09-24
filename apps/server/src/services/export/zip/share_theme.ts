import type { ZipExportProviderData } from "@triliumnext/core";
import ShareThemeExportProvider, { type ShareThemeExportAssets } from "@triliumnext/core/src/services/export/zip/share_theme.js";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { getClientDir, getShareThemeAssetDir } from "../../../routes/assets";
import { registerShareProvider } from "../../../share/share_provider.js";
import { RESOURCE_DIR } from "../../resource_dir";

/** Builds a share-theme export over the theme's built files and the client's fonts on disk. */
export function createShareThemeExportProvider(data: ZipExportProviderData) {
    registerShareProvider();

    return new ShareThemeExportProvider(data, readShareThemeExportAssets());
}

function readShareThemeExportAssets(): ShareThemeExportAssets {
    const shareThemeAssetDir = getShareThemeAssetDir();
    const files = new Map<string, Uint8Array>([
        [ "icon-color.svg", readFileSync(join(RESOURCE_DIR, "images", "icon-color.svg")) ]
    ]);

    for (const file of readdirSync(shareThemeAssetDir)) {
        files.set(`assets/${file}`, readFileSync(join(shareThemeAssetDir, file)));
    }

    return {
        files,
        readBuiltinFont: (fileName) => readFileSync(join(getClientDir(), "fonts", fileName))
    };
}
