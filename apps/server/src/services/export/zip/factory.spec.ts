import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

class FakeHtml {
    constructor(public data: any, public opts: any) {}
}
class FakeMarkdown {
    constructor(public data: any) {}
}
class FakeShare {
    constructor(public data: any) {}
}

vi.mock("@triliumnext/core/src/services/export/zip/html.js", () => ({ default: FakeHtml }));
vi.mock("@triliumnext/core/src/services/export/zip/markdown.js", () => ({ default: FakeMarkdown }));
vi.mock("./share_theme.js", () => ({ default: FakeShare }));

const data = { branch: {} } as any;

/**
 * `isDev` in utils.ts is a module-load constant derived from TRILIUM_ENV, so to
 * exercise both readContentCss branches we re-import the factory with modules
 * reset under each env value (the html/markdown/share mocks are re-applied).
 */
async function importFactory(dev: boolean) {
    vi.resetModules();
    vi.doMock("@triliumnext/core/src/services/export/zip/html.js", () => ({ default: FakeHtml }));
    vi.doMock("@triliumnext/core/src/services/export/zip/markdown.js", () => ({ default: FakeMarkdown }));
    vi.doMock("./share_theme.js", () => ({ default: FakeShare }));
    if (dev) {
        vi.stubEnv("TRILIUM_ENV", "dev");
    } else {
        vi.stubEnv("TRILIUM_ENV", "");
    }
    return (await import("./factory.js")).serverZipExportProviderFactory;
}

let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("body { color: red; }" as any);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("serverZipExportProviderFactory", () => {
    it("builds an HTML provider, reading content CSS from the resource dir in production", async () => {
        const factory = await importFactory(false);
        const provider = await factory("html", data);

        expect(provider).toBeInstanceOf(FakeHtml);
        expect((provider as any).opts.contentCss).toBe("body { color: red; }");
        // production reads the bundled css next to the resource dir
        const readPath = readFileSyncSpy.mock.calls[0][0] as string;
        expect(readPath).toContain("ckeditor5-content.css");
        expect(readPath).not.toContain("node_modules");
    });

    it("builds an HTML provider, resolving content CSS from the ckeditor5 package in dev mode", async () => {
        const factory = await importFactory(true);
        await factory("html", data);

        const readPath = readFileSyncSpy.mock.calls[0][0] as string;
        expect(readPath).toContain("ckeditor5-content.css");
        // dev resolves the file from the ckeditor5 package (under node_modules),
        // unlike the production path which reads from the resource dir.
        expect(readPath).toContain("node_modules");
    });

    it("builds a Markdown provider without reading any CSS", async () => {
        const factory = await importFactory(false);
        const provider = await factory("markdown", data);

        expect(provider).toBeInstanceOf(FakeMarkdown);
        expect(readFileSyncSpy).not.toHaveBeenCalled();
    });

    it("builds a Share theme provider", async () => {
        const factory = await importFactory(false);
        const provider = await factory("share", data);

        expect(provider).toBeInstanceOf(FakeShare);
    });

    it("throws on an unsupported format", async () => {
        const factory = await importFactory(false);
        await expect(factory("xml" as any, data)).rejects.toThrow(/Unsupported export format/);
    });
});
