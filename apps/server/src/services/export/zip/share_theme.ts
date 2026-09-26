import type { ShareMermaidManifest } from "@triliumnext/commons";
import type { ZipExportProviderData } from "@triliumnext/core";
import ShareThemeExportProvider, {
    hasMermaidDiagrams,
    mapMermaidExportFiles,
    type ShareThemeExportAssets
} from "@triliumnext/core/src/services/export/zip/share_theme.js";
import { getLog } from "@triliumnext/core/src/services/log.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

import { getClientBuildDir, getClientDir, getShareThemeAssetDir } from "../../../routes/assets";
import { registerShareProvider } from "../../../share/share_provider.js";
import { RESOURCE_DIR } from "../../resource_dir";

/**
 * Builds a share-theme export over the theme's built files, the client's fonts and, when a note
 * has a diagram, the client's mermaid, all read from disk.
 */
export function createShareThemeExportProvider(data: ZipExportProviderData) {
    registerShareProvider();

    const assets = readShareThemeExportAssets();
    if (hasMermaidDiagrams(data.branch.getNote())) {
        addMermaidFiles(assets.files);
    }

    return new ShareThemeExportProvider(data, assets);
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

/**
 * Copies the client's mermaid into the export. Without a client build to copy from, which a
 * development server might lack, the exported pages show diagrams as code blocks.
 */
function addMermaidFiles(files: Map<string, string | Uint8Array>) {
    const manifestDir = join(getClientBuildDir(), "src");
    const manifestPath = join(manifestDir, "share_mermaid.json");
    if (!existsSync(manifestPath)) {
        getLog().info(`Exporting without mermaid, since ${manifestPath} is missing.`);
        return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ShareMermaidManifest;
    const mapped = mapMermaidExportFiles(manifest);
    if (!mapped) {
        getLog().info(`Exporting without mermaid, since ${manifestPath} lists no built files.`);
        return;
    }

    files.set(mapped.manifest.path, mapped.manifest.content);
    for (const { source, target } of mapped.files) {
        files.set(target, readFileSync(join(manifestDir, source)));
    }
}
