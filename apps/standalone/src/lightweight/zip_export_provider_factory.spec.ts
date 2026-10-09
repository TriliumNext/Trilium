import type { ZipExportProviderData } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import BrowserZipProvider from "./zip_provider.js";
import { standaloneZipExportProviderFactory } from "./zip_export_provider_factory.js";

// Vitest imports a stylesheet with `?raw` as an empty string, so the three stand in with markers.
vi.mock("@triliumnext/ckeditor5/src/theme/admonitions.css?raw", () => ({ default: ".admonition {}" }));
vi.mock("@triliumnext/ckeditor5/src/theme/ck-content.css?raw", () => ({ default: ".content {}" }));
vi.mock("@triliumnext/ckeditor5/src/theme/multicolumn.css?raw", () => ({ default: ".columns {}" }));

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
    it("creates an HTML export provider with content, admonition and column styles", async () => {
        const data = makeData();
        const provider = await standaloneZipExportProviderFactory("html", data);
        expect(provider.constructor.name).toBe("HtmlExportProvider");
        expect(provider.branch).toBe(data.branch);

        const { options } = provider as unknown as { options: { contentCss?: string } };
        expect(options.contentCss).toBe(".content {}\n.admonition {}\n.columns {}");
    });

    it("creates a Markdown export provider", async () => {
        const provider = await standaloneZipExportProviderFactory("markdown", makeData());
        expect(provider.constructor.name).toBe("MarkdownExportProvider");
    });

    it("creates a share-theme export provider over the files the manifest lists", async () => {
        stubBuild();

        const provider = await standaloneZipExportProviderFactory("share", makeData());
        expect(provider.constructor.name).toBe("ShareThemeExportProvider");

        const { files, readBuiltinFont } = (provider as unknown as { assets: {
            files: Map<string, string | Uint8Array>;
            readBuiltinFont(fileName: string): Uint8Array | undefined;
        } }).assets;
        expect([ ...files.keys() ])
            .toEqual([ "icon-color.svg", "assets/scripts.js", "assets/scripts.css" ]);
        expect(files.get("icon-color.svg")).toContain("<svg");
        expect(new TextDecoder().decode(files.get("assets/scripts.css") as Uint8Array))
            .toBe("content of /src/scripts.css");
        expect(new TextDecoder().decode(readBuiltinFont("boxicons.woff2")))
            .toBe("content of /share/assets/fonts/boxicons.woff2");
    });

    it("adds the files of mermaid when a note has a diagram", async () => {
        stubBuild();

        const provider = await standaloneZipExportProviderFactory("share",
            makeData(`<pre><code class="language-mermaid">graph TD;</code></pre>`));

        type WithAssets = { assets: { files: Map<string, string | Uint8Array> } };
        const { files } = (provider as unknown as WithAssets).assets;
        expect(new TextDecoder().decode(files.get("assets/mermaid.core-a.js") as Uint8Array))
            .toBe("content of /src/mermaid.core-a.js");
    });

    it("fails the share-theme export when the development server serves no manifest", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>")));

        await expect(standaloneZipExportProviderFactory("share", makeData()))
            .rejects.toThrow("/src/share_theme.json is not its manifest");
    });

    it("fails the share-theme export when a theme file cannot be fetched", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("share_theme.json")
            ? new Response(JSON.stringify(MANIFEST))
            : new Response("", { status: 404 }))));

        await expect(standaloneZipExportProviderFactory("share", makeData()))
            .rejects.toThrow("/src/scripts.js");
    });

    it("throws for an unsupported format", async () => {
        await expect(
            standaloneZipExportProviderFactory("pdf" as never, makeData())
        ).rejects.toThrow("Unsupported export format: 'pdf'");
    });
});

const MANIFEST = {
    files: [ "scripts.js", "scripts.css" ],
    lazy: { mermaid: [ "mermaid.core-a.js" ] }
};

/** Serves {@link MANIFEST} and, for every other file, its path. */
function stubBuild() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
        url.endsWith("share_theme.json") ? JSON.stringify(MANIFEST) : `content of ${url}`
    )));
}
