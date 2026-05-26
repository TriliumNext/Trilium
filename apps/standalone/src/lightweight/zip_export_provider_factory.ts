import { type ExportFormat, type ZipExportProviderData, ZipExportProvider } from "@triliumnext/core";

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
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}
