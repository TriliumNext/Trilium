import type { ShareThemeManifest } from "@triliumnext/commons";
import {
    binary_utils,
    type ExportFormat,
    icon_packs,
    type ZipExportProviderData,
    ZipExportProvider
} from "@triliumnext/core";
import type {
    ShareThemeExportAssets
} from "@triliumnext/core/src/services/export/zip/share_theme.js";

import admonitionsCss from "@triliumnext/ckeditor5/src/theme/admonitions.css?raw";
import contentCss from "@triliumnext/ckeditor5/src/theme/ck-content.css?raw";
import multicolumnCss from "@triliumnext/ckeditor5/src/theme/multicolumn.css?raw";

export async function standaloneZipExportProviderFactory(format: ExportFormat, data: ZipExportProviderData): Promise<ZipExportProvider> {
    switch (format) {
        case "html": {
            const { default: HtmlExportProvider } = await import("@triliumnext/core/src/services/export/zip/html.js");
            return new HtmlExportProvider(data, {
                contentCss: `${contentCss}\n${admonitionsCss}\n${multicolumnCss}`
            });
        }
        case "markdown": {
            const { default: MarkdownExportProvider } = await import("@triliumnext/core/src/services/export/zip/markdown.js");
            return new MarkdownExportProvider(data);
        }
        case "share": {
            const [ shareTheme, { registerShareProvider }, manifest ] = await Promise.all([
                import("@triliumnext/core/src/services/export/zip/share_theme.js"),
                import("./share_provider.js"),
                loadShareThemeManifest()
            ]);
            const files = shareTheme.getShareThemeExportFiles(manifest, data.branch.getNote());
            const assets = await loadShareThemeExportAssets(files);
            registerShareProvider();
            return new shareTheme.default(data, assets);
        }
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}

/**
 * Fetches the manifest of the share theme, which the build writes beside its files in `src/`. The
 * development server builds no share theme, so its exports fail here.
 */
async function loadShareThemeManifest(): Promise<ShareThemeManifest> {
    const content = binary_utils.decodeUtf8(await fetchAsset(SHARE_THEME_MANIFEST));
    try {
        return JSON.parse(content) as ShareThemeManifest;
    } catch {
        throw new Error(`Unable to export with the share theme, since ${SHARE_THEME_MANIFEST} is`
            + " not its manifest. Exporting needs a production build.");
    }
}

/**
 * Fetches the share theme's `files` from `src/` and the built-in icon fonts from `share/assets`,
 * where the build places them for the share pages. The export reads them synchronously, so they
 * are all loaded before it starts.
 */
async function loadShareThemeExportAssets(themeFiles: string[]): Promise<ShareThemeExportAssets> {
    const { default: iconColorSvg } =
        await import("../../../server/src/assets/images/icon-color.svg?raw");
    const fontFiles = icon_packs.getIconPacks()
        .filter((iconPack) => iconPack.builtin)
        .map((iconPack) => `${iconPack.fontAttachmentId}.${icon_packs.MIME_TO_EXTENSION_MAPPINGS[iconPack.fontMime]}`);

    const [ themeContents, fontContents ] = await Promise.all([
        Promise.all(themeFiles.map((file) => fetchAsset(`/src/${file}`))),
        Promise.all(fontFiles.map((file) => fetchAsset(`/share/assets/fonts/${file}`)))
    ]);

    const files = new Map<string, string | Uint8Array>([ [ "icon-color.svg", iconColorSvg ] ]);
    for (const [ index, file ] of themeFiles.entries()) {
        files.set(`assets/${file}`, themeContents[index]);
    }
    const fonts = new Map(fontFiles.map((file, index) => [ file, fontContents[index] ]));

    return {
        files,
        readBuiltinFont: (fileName) => fonts.get(fileName)
    };
}

const SHARE_THEME_MANIFEST = "/src/share_theme.json";

async function fetchAsset(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url} for the share-theme export: HTTP ${response.status}.`);
    }

    return new Uint8Array(await response.arrayBuffer());
}
