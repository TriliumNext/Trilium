import type { ZipExportProviderData } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import BrowserZipProvider from "./zip_provider.js";
import { standaloneZipExportProviderFactory } from "./zip_export_provider_factory.js";

vi.mock("virtual:share-theme-assets", () => ({ default: [ "styles.css", "scripts.js" ] }));

function makeData(content = "<p>No diagrams.</p>"): ZipExportProviderData {
    const note = {
        getSubtree: () => ({
            notes: [ { type: "text", isContentAvailable: () => true, getContent: () => content } ]
        })
    };
    return {
        branch: { branchId: "test", getNote: () => note },
        getNoteTargetUrl: () => null,
        archive: new BrowserZipProvider().createZipArchive(),
        zipExportOptions: undefined,
        rewriteFn: (content: string) => content
    } as unknown as ZipExportProviderData;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

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

    it("creates a share-theme export provider over the theme files the build serves", async () => {
        const fetchMock = vi.fn(async (url: string) => new Response(`content of ${url}`));
        vi.stubGlobal("fetch", fetchMock);

        const provider = await standaloneZipExportProviderFactory("share", makeData());
        expect(provider.constructor.name).toBe("ShareThemeExportProvider");

        const { files, readBuiltinFont } = (provider as unknown as { assets: {
            files: Map<string, string | Uint8Array>;
            readBuiltinFont(fileName: string): Uint8Array | undefined;
        } }).assets;
        expect([ ...files.keys() ]).toEqual([ "icon-color.svg", "assets/styles.css", "assets/scripts.js" ]);
        expect(files.get("icon-color.svg")).toContain("<svg");
        expect(new TextDecoder().decode(files.get("assets/styles.css") as Uint8Array))
            .toBe("content of /share/assets/styles.css");
        expect(new TextDecoder().decode(readBuiltinFont("boxicons.woff2")))
            .toBe("content of /share/assets/fonts/boxicons.woff2");
    });

    it("adds the client's mermaid through its manifest when a note has a diagram", async () => {
        const manifest = { entry: "../../../src/entry-a.js", files: [ "../../../src/entry-a.js" ] };
        vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
            url.endsWith("share_mermaid.json")
                ? JSON.stringify(manifest)
                : `content of ${new URL(url, location.href).pathname}`
        )));

        const provider = await standaloneZipExportProviderFactory("share",
            makeData(`<pre><code class="language-mermaid">graph TD;</code></pre>`));

        type WithAssets = { assets: { files: Map<string, string | Uint8Array> } };
        const { files } = (provider as unknown as WithAssets).assets;
        expect(JSON.parse(files.get("assets/client/share_mermaid.json") as string))
            .toEqual({ entry: "entry-a.js", files: [ "entry-a.js" ] });
        expect(new TextDecoder().decode(files.get("assets/client/entry-a.js") as Uint8Array))
            .toBe("content of /src/entry-a.js");
    });

    it("exports without mermaid when the development server lists no built files", async () => {
        const manifest = { entry: "/@fs/repo/apps/client/src/share_mermaid.ts", files: [] };
        vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
            url.endsWith("share_mermaid.json") ? JSON.stringify(manifest) : "content"
        )));

        const provider = await standaloneZipExportProviderFactory("share",
            makeData(`<pre><code class="language-mermaid">graph TD;</code></pre>`));

        type WithAssets = { assets: { files: Map<string, string | Uint8Array> } };
        const names = [ ...(provider as unknown as WithAssets).assets.files.keys() ];
        expect(names).toContain("assets/scripts.js");
        expect(names.filter((name) => name.startsWith("assets/client/"))).toEqual([]);
    });

    it("fails the share-theme export when a theme file cannot be fetched", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

        await expect(standaloneZipExportProviderFactory("share", makeData()))
            .rejects.toThrow("/share/assets/styles.css");
    });

    it("throws for an unsupported format", async () => {
        await expect(
            standaloneZipExportProviderFactory("pdf" as never, makeData())
        ).rejects.toThrow("Unsupported export format: 'pdf'");
    });
});
