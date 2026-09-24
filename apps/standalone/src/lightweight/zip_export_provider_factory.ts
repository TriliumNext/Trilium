import { type ExportFormat, icon_packs, type ZipExportProviderData, ZipExportProvider } from "@triliumnext/core";
import type { ShareThemeExportAssets } from "@triliumnext/core/src/services/export/zip/share_theme.js";

import contentCss from "@triliumnext/ckeditor5/src/theme/ck-content.css?raw";

export async function standaloneZipExportProviderFactory(format: ExportFormat, data: ZipExportProviderData): Promise<ZipExportProvider> {
    switch (format) {
        case "html": {
            const { default: HtmlExportProvider } = await import("@triliumnext/core/src/services/export/zip/html.js");
            return new HtmlExportProvider(data, { contentCss });
        }
        case "markdown": {
            const { default: MarkdownExportProvider } = await import("@triliumnext/core/src/services/export/zip/markdown.js");
            return new MarkdownExportProvider(data);
        }
        case "share": {
            const [ { default: ShareThemeExportProvider }, { registerShareProvider }, assets ] = await Promise.all([
                import("@triliumnext/core/src/services/export/zip/share_theme.js"),
                import("./share_provider.js"),
                loadShareThemeExportAssets()
            ]);
            registerShareProvider();
            return new ShareThemeExportProvider(data, assets);
        }
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}

/**
 * Fetches the share theme's files and the built-in icon fonts from `share/assets`, where the build
 * copies them for the share pages. The export reads them synchronously, so they are all loaded
 * before it starts.
 */
async function loadShareThemeExportAssets(): Promise<ShareThemeExportAssets> {
    const [ { default: themeFiles }, { default: iconColorSvg } ] = await Promise.all([
        import("virtual:share-theme-assets"),
        import("../../../server/src/assets/images/icon-color.svg?raw")
    ]);
    const fontFiles = icon_packs.getIconPacks()
        .filter((iconPack) => iconPack.builtin)
        .map((iconPack) => `${iconPack.fontAttachmentId}.${icon_packs.MIME_TO_EXTENSION_MAPPINGS[iconPack.fontMime]}`);

    const [ themeContents, fontContents ] = await Promise.all([
        Promise.all(themeFiles.map((file) => fetchAsset(`/share/assets/${file}`))),
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

async function fetchAsset(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url} for the share-theme export: HTTP ${response.status}.`);
    }

    return new Uint8Array(await response.arrayBuffer());
}
