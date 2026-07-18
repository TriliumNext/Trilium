import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

const mockFs = { readFileSync: vi.fn(), readdirSync: vi.fn() };
vi.mock("fs", () => ({
    default: mockFs,
    readFileSync: (...a: any[]) => mockFs.readFileSync(...a),
    readdirSync: (...a: any[]) => mockFs.readdirSync(...a)
}));

vi.mock("ejs", () => ({ default: { render: vi.fn(() => "<html>404</html>") } }));
vi.mock("html-to-text", () => ({ convert: vi.fn((s: string) => `TEXT:${s}`) }));

const mockAssets = {
    getClientDir: vi.fn(() => "/client"),
    getShareThemeAssetDir: vi.fn(() => "/share-assets")
};
vi.mock("../../../routes/assets", () => mockAssets);

const mockContentRenderer = {
    getDefaultTemplatePath: vi.fn((name: string) => `/templates/${name}`),
    readTemplate: vi.fn(() => "TEMPLATE"),
    renderNoteForExport: vi.fn(() => "<p>rendered</p>")
};
vi.mock("../../../share/content_renderer", () => mockContentRenderer);

vi.mock("../../resource_dir", () => ({ RESOURCE_DIR: "/resource" }));

const utils = { getResourceDir: vi.fn(() => "/res"), isDev: false };
vi.mock("../../utils", () => ({
    getResourceDir: () => utils.getResourceDir(),
    get isDev() {
        return utils.isDev;
    }
}));

const mockIconPacks: any[] = [];
const mockBecca = {
    getNote: vi.fn(),
    getAttachment: vi.fn()
};
const mockLog = { error: vi.fn(), info: vi.fn() };

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: mockBecca,
        getLog: () => mockLog,
        icon_packs: {
            ...actual.icon_packs,
            getIconPacks: vi.fn(() => mockIconPacks),
            MIME_TO_EXTENSION_MAPPINGS: { "font/woff2": "woff2", "font/ttf": "ttf" }
        }
    };
});

const { default: ShareThemeExportProvider } = await import("./share_theme.js");

// --- Test scaffolding -------------------------------------------------------

interface AppendCall {
    data: any;
    options: { name: string };
}
let appendCalls: AppendCall[];

function makeData(branchNote?: any) {
    const branch = {
        getNote: () => branchNote ?? {
            getContent: () => "<p>root</p>",
            noteId: "rootNote",
            getBestNotePath: () => ["root", "rootNote12345"]
        }
    };
    return {
        branch,
        getNoteTargetUrl: vi.fn((id: string) => `url/${id}`),
        archive: { append: vi.fn((data: any, options: any) => appendCalls.push({ data, options })) },
        zipExportOptions: undefined,
        rewriteFn: vi.fn((content: string) => content)
    } as any;
}

function makeProvider(branchNote?: any) {
    return new ShareThemeExportProvider(makeData(branchNote));
}

beforeEach(() => {
    vi.clearAllMocks();
    appendCalls = [];
    mockIconPacks.length = 0;
    utils.isDev = false;
    mockFs.readFileSync.mockReturnValue(Buffer.from("file-data"));
    mockFs.readdirSync.mockReturnValue(["a.css", "b.js"]);
    mockContentRenderer.renderNoteForExport.mockReturnValue("<p>rendered</p>");
});

afterEach(() => vi.restoreAllMocks());

describe("ShareThemeExportProvider", () => {
    describe("prepareMeta", () => {
        it("registers icon-color.svg, asset-dir files, and an index entry", () => {
            const provider = makeProvider();
            const metaFile: any = { files: [{ noteId: "rootNote", title: "Root" }] };

            provider.prepareMeta(metaFile);

            const dataFileNames = metaFile.files.map((f: any) => f.dataFileName).filter(Boolean);
            expect(dataFileNames).toContain("icon-color.svg");
            expect(dataFileNames).toContain("assets/a.css");
            expect(dataFileNames).toContain("assets/b.js");
            expect(dataFileNames).toContain("index.html");
            // rootMeta is taken from the first existing file entry
            expect((provider as any).rootMeta).toBe(metaFile.files[0]);
        });
    });

    describe("mapExtension", () => {
        it("returns null for images, js for javascript, null for .zip, html otherwise", () => {
            const p = makeProvider();
            expect(p.mapExtension("image", "image/png", "", "share")).toBeNull();
            expect(p.mapExtension("code", "application/javascript", "", "share")).toBe("js");
            expect(p.mapExtension("file", "application/zip", ".zip", "share")).toBeNull();
            expect(p.mapExtension("text", "text/html", "", "share")).toBe("html");
        });
    });

    describe("prepareContent", () => {
        it("throws when the note path is missing", () => {
            const p = makeProvider();
            expect(() => p.prepareContent("t", "x", { notePath: [] } as any, undefined as any, {} as any))
                .toThrow(/note path/i);
        });

        it("returns content unchanged when there is no note (no search index entry)", () => {
            const p = makeProvider();
            const result = p.prepareContent("t", "raw", { notePath: ["root", "a"] } as any, undefined as any, {} as any);
            expect(result).toBe("raw");
            expect((p as any).searchIndex.size).toBe(0);
        });

        it("rewrites attachment links, note links, and builds a search-index entry for a note", () => {
            const note = {
                noteId: "noteABC",
                getBestNotePath: () => ["root", "parent12chars", "noteABC12char"]
            };
            mockBecca.getNote.mockImplementation((id: string) =>
                id === "parent12chars" ? { title: "Parent" } : null);

            // Render output exercises both the attachment and note link rewrites.
            mockContentRenderer.renderNoteForExport.mockReturnValue(
                `<a href="api/attachments/att123456/download">f</a>` +
                `<a href="x./otherNote123">n</a>` +
                `<a href="x./assets/keepme12345">keep</a>`
            );

            const p = makeProvider();
            (p as any).rootMeta = { noteId: "rootNote" };
            const noteMeta: any = {
                notePath: ["root", "parent12chars", "noteABC12char"],
                attachments: [{ attachmentId: "att123456", dataFileName: "files/att.png" }]
            };

            const out = p.prepareContent("Title", "<p>html</p>", noteMeta, note as any, {} as any) as string;

            // Attachment download link rewritten to its data file name.
            expect(out).toContain('href="files/att.png"');
            // Plain note link rewritten to a hash anchor.
            expect(out).toContain('href="#root/otherNote123"');
            // /assets/ links are preserved untouched.
            expect(out).toContain("/assets/keepme12345");

            const entry = (p as any).searchIndex.get("noteABC");
            expect(entry.title).toBe("Title");
            expect(entry.content).toContain("TEXT:");
            // Path built from titles, excluding root and falsy titles.
            expect(entry.path).toBe("Parent");
        });

        it("keeps the original attachment link when the attachment has no data file (or no attachments at all)", () => {
            const note = { noteId: "noAtt", getBestNotePath: () => ["root", "noAtt1234567"] };
            mockBecca.getNote.mockReturnValue(null);
            mockContentRenderer.renderNoteForExport.mockReturnValue(
                `<a href="api/attachments/att999999/download">f</a>`
            );

            const p = makeProvider();
            // attachment present but without a dataFileName → keep original match (line 79 false).
            const withAtt: any = {
                notePath: ["root", "noAtt1234567"],
                attachments: [{ attachmentId: "att999999" }]
            };
            const out1 = p.prepareContent("t", "<p>c</p>", withAtt, note as any, {} as any) as string;
            expect(out1).toContain('href="api/attachments/att999999/download"');

            // no attachments array at all → (noteMeta.attachments || []) fallback (line 78).
            const noAttArr: any = { notePath: ["root", "noAtt1234567"] };
            const out2 = p.prepareContent("t", "<p>c</p>", noAttArr, note as any, {} as any) as string;
            expect(out2).toContain('href="api/attachments/att999999/download"');
        });

        it("rewrites a note link pointing at the root to the base path", () => {
            const note = { noteId: "rootChild", getBestNotePath: () => ["root", "rootNote12345"] };
            mockBecca.getNote.mockReturnValue(null);
            mockContentRenderer.renderNoteForExport.mockReturnValue(`<a href="x./rootNote1234">root</a>`);

            const p = makeProvider();
            (p as any).rootMeta = { noteId: "rootNote1234" };
            const noteMeta: any = { notePath: ["root", "rootNote1234"], attachments: [] };

            const out = p.prepareContent("t", "<p>c</p>", noteMeta, note as any, {} as any) as string;
            // basePath for a 2-element path is "" (root link points to the base).
            expect(out).toContain('href=""');
        });

        it("leaves binary (non-string) content untouched but still indexes the note", () => {
            const note = { noteId: "binNote", getBestNotePath: () => ["root", "binNote12345"] };
            mockBecca.getNote.mockReturnValue(null);
            mockContentRenderer.renderNoteForExport.mockReturnValue(new Uint8Array([1, 2, 3]) as any);

            const p = makeProvider();
            const noteMeta: any = { notePath: ["root", "binNote12345"], attachments: [] };

            const out = p.prepareContent("Bin", new Uint8Array([9]), noteMeta, note as any, {} as any);
            expect(out).toBeInstanceOf(Uint8Array);
            // Binary input means empty search content.
            expect((p as any).searchIndex.get("binNote").content).toBe("");
        });
    });

    describe("afterDone", () => {
        it("writes index, 404, assets, fonts, and the search index json", () => {
            const p = makeProvider();
            (p as any).indexMeta = { dataFileName: "index.html" };
            (p as any).assetsMeta = [{ dataFileName: "icon-color.svg" }, { dataFileName: undefined }];
            (p as any).rootMeta = { noteId: "rootNote" };

            // A builtin icon pack (read from client dir) and a custom one (from becca).
            mockIconPacks.push(
                { prefix: "BX", fontMime: "font/woff2", fontAttachmentId: "boxicons", builtin: true },
                { prefix: "Custom", fontMime: "font/ttf", fontAttachmentId: "customAtt", builtin: false }
            );
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue({ getContent: () => Buffer.from("font") });

            // search index with one valid + one null-id entry
            (p as any).searchIndex.set("n1", { id: "n1", title: "T", content: "c", path: "p" });
            (p as any).searchIndex.set("n2", { id: null, title: "T2", content: "c2", path: "p2" });
            (p as any).getNoteTargetUrl.mockReturnValue("resolved/n1");

            // #saveIndex re-runs prepareContent against rootMeta, so it needs a notePath.
            const rootMeta: any = { noteId: "rootNote", title: "Root", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            const names = appendCalls.map((c) => c.options.name);
            expect(names).toContain("index.html");
            expect(names).toContain("404.html");
            expect(names).toContain("icon-color.svg");
            expect(names).toContain("assets/icon-pack-bx.woff2");
            expect(names).toContain("assets/icon-pack-custom.ttf");
            expect(names).toContain("search-index.json");

            const searchAppend = appendCalls.find((c) => c.options.name === "search-index.json")!;
            const parsed = JSON.parse(searchAppend.data);
            // Only the entry with a non-null id is URL-resolved; both are serialized.
            expect(parsed.find((e: any) => e.id === "resolved/n1")).toBeTruthy();
        });

        it("buffers binary index content and appends string font data as-is", () => {
            const p = makeProvider();
            (p as any).indexMeta = { dataFileName: "index.html" };
            (p as any).assetsMeta = [];
            (p as any).rootMeta = { noteId: "rootNote" };

            // renderNoteForExport returns binary → prepareContent returns binary →
            // #saveIndex takes the Buffer.from(content) branch (line 149 else).
            mockContentRenderer.renderNoteForExport.mockReturnValue(new Uint8Array([1, 2, 3]) as any);

            // A custom icon pack whose font content is a string exercises line 177's string branch.
            mockIconPacks.push({ prefix: "Str", fontMime: "font/ttf", fontAttachmentId: "strAtt", builtin: false });
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue({ getContent: () => "string-font-data" });

            const rootMeta: any = { noteId: "rootNote", title: "Root", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            const index = appendCalls.find((c) => c.options.name === "index.html")!;
            expect(Buffer.isBuffer(index.data)).toBe(true);
            const font = appendCalls.find((c) => c.options.name === "assets/icon-pack-str.ttf")!;
            expect(font.data).toBe("string-font-data");
        });

        it("defaults the index title to an empty string when rootMeta has no title", () => {
            const p = makeProvider();
            (p as any).indexMeta = { dataFileName: "index.html" };
            (p as any).assetsMeta = [];
            (p as any).rootMeta = { noteId: "rootNote" };
            mockContentRenderer.renderNoteForExport.mockReturnValue("<p>x</p>");

            // No `title` → exercises the `?? ""` fallback on line 148.
            const rootMeta: any = { noteId: "rootNote", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            expect(mockContentRenderer.renderNoteForExport).toHaveBeenCalled();
            expect(appendCalls.map((c) => c.options.name)).toContain("index.html");
        });

        it("skips the index when there is no index data file name", () => {
            const p = makeProvider();
            (p as any).indexMeta = null;
            (p as any).assetsMeta = [];
            p.afterDone({ noteId: "rootNote", title: "Root" } as any);

            expect(appendCalls.map((c) => c.options.name)).not.toContain("index.html");
            // 404 + search-index are still written.
            expect(appendCalls.map((c) => c.options.name)).toContain("404.html");
        });

        it("logs an error and skips a font when its data cannot be found", () => {
            const p = makeProvider();
            (p as any).indexMeta = null;
            (p as any).assetsMeta = [];
            mockIconPacks.push({ prefix: "Missing", fontMime: "font/ttf", fontAttachmentId: "gone", builtin: false });
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue(undefined);

            p.afterDone({ noteId: "rootNote", title: "Root" } as any);

            expect(mockLog.error).toHaveBeenCalled();
            expect(appendCalls.map((c) => c.options.name)).not.toContain("assets/icon-pack-missing.ttf");
        });
    });
});

describe("getShareThemeAssets (asset resolution branches)", () => {
    // getShareThemeAssets is private to the module; it is exercised through
    // afterDone's #saveAssets, which calls it for each asset data file name.
    function runSaveAssets(assetNames: string[], dev: boolean) {
        utils.isDev = dev;
        const p = makeProvider();
        (p as any).indexMeta = null;
        (p as any).assetsMeta = assetNames.map((n) => ({ dataFileName: n }));
        (p as any).iconPacks = [];
        p.afterDone({ noteId: "rootNote", title: "Root" } as any);
        // Normalize path separators so assertions are OS-independent.
        return mockFs.readFileSync.mock.calls.map((c) => String(c[0]).split("\\").join("/"));
    }

    it("resolves icon-color.svg from the resource images dir", () => {
        const reads = runSaveAssets(["icon-color.svg"], false);
        expect(reads.some((p) => p.includes("/resource") && p.includes("icon-color.svg"))).toBe(true);
    });

    it("resolves assets/* relative to the share theme asset dir", () => {
        const reads = runSaveAssets(["assets/style.css"], false);
        expect(reads.some((p) => p.includes("/share-assets") && p.includes("style.css"))).toBe(true);
    });

    it("resolves other files from the client dist in dev mode", () => {
        const reads = runSaveAssets(["main.js"], true);
        expect(reads.some((p) => p.includes("client") && p.includes("dist"))).toBe(true);
    });

    it("resolves other files from the public dir in production", () => {
        const reads = runSaveAssets(["main.js"], false);
        expect(reads.some((p) => p.includes("public") && p.includes("main.js"))).toBe(true);
    });
});
