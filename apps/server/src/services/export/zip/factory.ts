import { type ExportFormat, ZipExportProvider, type ZipExportProviderData } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { getResourceDir, isDev } from "../../utils.js";

function readContentCss(): string {
    const cssFile = isDev
        ? path.join(require.resolve("ckeditor5/ckeditor5-content.css"))
        : path.join(getResourceDir(), "ckeditor5-content.css");
    return fs.readFileSync(cssFile, "utf-8");
}

export async function serverZipExportProviderFactory(format: ExportFormat, data: ZipExportProviderData): Promise<ZipExportProvider> {
    switch (format) {
        case "html": {
            const { default: HtmlExportProvider } = await import("@triliumnext/core/src/services/export/zip/html.js");
            return new HtmlExportProvider(data, { contentCss: readContentCss() });
        }
        case "markdown": {
            const { default: MarkdownExportProvider } = await import("@triliumnext/core/src/services/export/zip/markdown.js");
            return new MarkdownExportProvider(data);
        }
        case "share": {
            const { default: ShareThemeExportProvider } = await import("./share_theme.js");
            return new ShareThemeExportProvider(data);
        }
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}
