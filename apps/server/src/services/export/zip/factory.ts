import { type ExportFormat, ZipExportProvider, type ZipExportProviderData } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { getResourceDir, isDev } from "../../utils.js";

/** The stylesheet of an HTML export: CKEditor's content styles, then the multicolumn layout's. */
function readContentCss(): string {
    const cssFiles = isDev
        ? [
            require.resolve("ckeditor5/ckeditor5-content.css"),
            // In development the resource directory is `apps/server/src`.
            path.join(getResourceDir(), "../../../packages/ckeditor5/src/theme/multicolumn.css")
        ]
        : [ "ckeditor5-content.css", "ckeditor5-multicolumn.css" ]
            .map((fileName) => path.join(getResourceDir(), fileName));
    return cssFiles.map((cssFile) => fs.readFileSync(cssFile, "utf-8")).join("\n");
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
            const { createShareThemeExportProvider } = await import("./share_theme.js");
            return createShareThemeExportProvider(data);
        }
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}
