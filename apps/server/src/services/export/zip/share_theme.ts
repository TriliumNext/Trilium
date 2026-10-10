import type { ShareThemeManifest } from "@triliumnext/commons";
import type { ZipExportProviderData } from "@triliumnext/core";
import ShareThemeExportProvider, {
    getShareThemeExportFiles,
    getShareThemeTranslationFiles,
    type ShareThemeExportAssets
} from "@triliumnext/core/src/services/export/zip/share_theme.js";
import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";

import { getClientDir, getShareThemeAssetDir } from "../../../routes/assets";
import { registerShareProvider } from "../../../share/share_provider.js";
import { RESOURCE_DIR } from "../../resource_dir";

/**
 * Builds a share-theme export over the files the client build lists in its share theme manifest,
 * the client's catalogues the app views read and the client's fonts, all read from disk.
 */
export function createShareThemeExportProvider(data: ZipExportProviderData) {
    registerShareProvider();

    const assetDir = getShareThemeAssetDir();
    const manifestPath = join(assetDir, "share_theme.json");
    if (!existsSync(manifestPath)) {
        throw new Error(`Unable to export with the share theme, since ${manifestPath} is missing.`
            + " Build the client first.");
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ShareThemeManifest;
    const files = new Map<string, Uint8Array>([
        [ "icon-color.svg", readFileSync(join(RESOURCE_DIR, "images", "icon-color.svg")) ]
    ]);
    const note = data.branch.getNote();
    for (const file of getShareThemeExportFiles(manifest, note)) {
        files.set(`assets/${basename(file)}`, readFileSync(join(assetDir, file)));
    }
    for (const file of getShareThemeTranslationFiles(note)) {
        const path = join(getClientDir(), "translations", file);
        if (existsSync(path)) {
            files.set(`assets/translations/${file}`, readFileSync(path));
        }
    }

    const assets: ShareThemeExportAssets = {
        files,
        readBuiltinFont: (fileName) => readFileSync(join(getClientDir(), "fonts", fileName))
    };
    return new ShareThemeExportProvider(data, assets);
}
