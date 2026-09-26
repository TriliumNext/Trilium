import type { ShareMermaidManifest } from "@triliumnext/commons";
import {
    binary_utils,
    type ExportFormat,
    getLog,
    icon_packs,
    type ZipExportProviderData,
    ZipExportProvider
} from "@triliumnext/core";
import type {
    mapMermaidExportFiles,
    ShareThemeExportAssets
} from "@triliumnext/core/src/services/export/zip/share_theme.js";

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
            const [ shareTheme, { registerShareProvider }, assets ] = await Promise.all([
                import("@triliumnext/core/src/services/export/zip/share_theme.js"),
                import("./share_provider.js"),
                loadShareThemeExportAssets()
            ]);
            if (shareTheme.hasMermaidDiagrams(data.branch.getNote())) {
                await addMermaidFiles(assets.files, shareTheme.mapMermaidExportFiles);
            }
            registerShareProvider();
            return new shareTheme.default(data, assets);
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

/**
 * Fetches the client's mermaid through the manifest the build writes next to the share theme. The
 * development server's manifest lists no built files, so its exports show diagrams as code blocks.
 */
async function addMermaidFiles(
    files: Map<string, string | Uint8Array>,
    mapFiles: typeof mapMermaidExportFiles
) {
    const manifestUrl = new URL(SHARE_MERMAID_MANIFEST, location.href);
    const manifestBytes = await fetchAsset(manifestUrl.href);
    const manifest = JSON.parse(binary_utils.decodeUtf8(manifestBytes)) as ShareMermaidManifest;
    const mapped = mapFiles(manifest);
    if (!mapped) {
        getLog().info("Exporting without mermaid, since the manifest lists no built files.");
        return;
    }

    const contents = await Promise.all(mapped.files.map(({ source }) =>
        fetchAsset(new URL(source, manifestUrl).href)));

    files.set(mapped.manifest.path, mapped.manifest.content);
    for (const [ index, { target } ] of mapped.files.entries()) {
        files.set(target, contents[index]);
    }
}

const SHARE_MERMAID_MANIFEST = "/share/assets/client/share_mermaid.json";

async function fetchAsset(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url} for the share-theme export: HTTP ${response.status}.`);
    }

    return new Uint8Array(await response.arrayBuffer());
}
