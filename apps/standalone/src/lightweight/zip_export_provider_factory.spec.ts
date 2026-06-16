import type { ZipExportProviderData } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import BrowserZipProvider from "./zip_provider.js";
import { standaloneZipExportProviderFactory } from "./zip_export_provider_factory.js";

function makeData(): ZipExportProviderData {
    return {
        branch: { branchId: "test" },
        getNoteTargetUrl: () => null,
        archive: new BrowserZipProvider().createZipArchive(),
        zipExportOptions: undefined,
        rewriteFn: (content: string) => content
    } as unknown as ZipExportProviderData;
}

describe("standaloneZipExportProviderFactory", () => {
    it("creates an HTML export provider", async () => {
        const data = makeData();
        const provider = await standaloneZipExportProviderFactory("html", data);
        expect(provider.constructor.name).toBe("HtmlExportProvider");
        expect(provider.branch).toBe(data.branch);
    });

    it("creates a Markdown export provider", async () => {
        const provider = await standaloneZipExportProviderFactory("markdown", makeData());
        expect(provider.constructor.name).toBe("MarkdownExportProvider");
    });

    it("throws for an unsupported format", async () => {
        await expect(
            standaloneZipExportProviderFactory("pdf" as never, makeData())
        ).rejects.toThrow("Unsupported export format: 'pdf'");
    });
});
