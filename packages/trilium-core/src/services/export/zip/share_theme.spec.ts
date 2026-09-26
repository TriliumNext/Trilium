import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

vi.mock("ejs", () => ({ default: { render: vi.fn(() => "<html>404</html>") } }));
vi.mock("html-to-text", () => ({ convert: vi.fn((s: string) => `TEXT:${s}`) }));

const mockContentRenderer = {
    readShareTemplate: vi.fn(() => "TEMPLATE"),
    renderNoteForExport: vi.fn(() => "<p>rendered</p>")
};
vi.mock("../../../share/index.js", () => mockContentRenderer);

const mockIconPacks: any[] = [];
vi.mock("../../icon_packs.js", () => ({
    getIconPacks: vi.fn(() => mockIconPacks),
    MIME_TO_EXTENSION_MAPPINGS: { "font/woff2": "woff2", "font/ttf": "ttf" }
}));

const mockBecca = {
    getNote: vi.fn(),
    getAttachment: vi.fn()
};
vi.mock("../../../becca/becca.js", () => ({ default: mockBecca }));

const mockLog = { error: vi.fn(), info: vi.fn() };
vi.mock("../../log.js", () => ({ getLog: () => mockLog }));

const {
    default: ShareThemeExportProvider,
    hasMermaidDiagrams,
    mapMermaidExportFiles
} = await import("./share_theme.js");

// --- Test scaffolding -------------------------------------------------------

interface AppendCall {
    data: any;
    options: { name: string };
}
let appendCalls: AppendCall[];

const iconColor = new Uint8Array([ 1 ]);
const styles = "body {}";
const readBuiltinFont = vi.fn((_fileName: string): Uint8Array | undefined => new Uint8Array([ 2 ]));

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
    return new ShareThemeExportProvider(makeData(branchNote), {
        files: new Map<string, string | Uint8Array>([
            [ "icon-color.svg", iconColor ],
            [ "assets/styles.css", styles ]
        ]),
        readBuiltinFont
    });
}

function findAppend(name: string) {
    const call = appendCalls.find((c) => c.options.name === name);
    if (!call) {
        throw new Error(`Nothing appended as ${name}`);
    }
    return call;
}

beforeEach(() => {
    vi.clearAllMocks();
    appendCalls = [];
    mockIconPacks.length = 0;
    mockContentRenderer.renderNoteForExport.mockReturnValue("<p>rendered</p>");
});

afterEach(() => vi.restoreAllMocks());

describe("ShareThemeExportProvider", () => {
    describe("prepareMeta", () => {
        it("registers each asset file and an index entry", () => {
            const provider = makeProvider();
            const metaFile: any = { files: [{ noteId: "rootNote", title: "Root" }] };

            provider.prepareMeta(metaFile);

            const dataFileNames = metaFile.files.map((f: any) => f.dataFileName).filter(Boolean);
            expect(dataFileNames).toEqual([ "icon-color.svg", "assets/styles.css", "index.html" ]);
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
            // Attachment present but without a dataFileName.
            const withAtt: any = {
                notePath: ["root", "noAtt1234567"],
                attachments: [{ attachmentId: "att999999" }]
            };
            const out1 = p.prepareContent("t", "<p>c</p>", withAtt, note as any, {} as any) as string;
            expect(out1).toContain('href="api/attachments/att999999/download"');

            // No attachments array at all.
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
            (p as any).rootMeta = { noteId: "rootNote" };

            // A builtin icon pack (read through the platform's assets) and a custom one (from becca).
            mockIconPacks.push(
                { prefix: "BX", fontMime: "font/woff2", fontAttachmentId: "boxicons", builtin: true },
                { prefix: "Custom", fontMime: "font/ttf", fontAttachmentId: "customAtt", builtin: false }
            );
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue({ getContent: () => new Uint8Array([ 3 ]) });

            // search index with one valid + one null-id entry
            (p as any).searchIndex.set("n1", { id: "n1", title: "T", content: "c", path: "p" });
            (p as any).searchIndex.set("n2", { id: null, title: "T2", content: "c2", path: "p2" });
            (p as any).getNoteTargetUrl.mockReturnValue("resolved/n1");

            // #saveIndex re-runs prepareContent against rootMeta, so it needs a notePath.
            const rootMeta: any = { noteId: "rootNote", title: "Root", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            expect(appendCalls.map((c) => c.options.name)).toEqual(expect.arrayContaining([
                "index.html", "404.html", "search-index.json", "assets/icon-pack-custom.ttf"
            ]));
            expect(findAppend("icon-color.svg").data).toBe(iconColor);
            expect(findAppend("assets/styles.css").data).toBe(styles);
            expect(readBuiltinFont).toHaveBeenCalledWith("boxicons.woff2");
            expect(findAppend("assets/icon-pack-bx.woff2").data).toEqual(new Uint8Array([ 2 ]));

            const parsed = JSON.parse(findAppend("search-index.json").data);
            // Only the entry with a non-null id is URL-resolved; both are serialized.
            expect(parsed.find((e: any) => e.id === "resolved/n1")).toBeTruthy();
        });

        it("appends binary index content and string font data as-is", () => {
            const p = makeProvider();
            (p as any).indexMeta = { dataFileName: "index.html" };
            (p as any).rootMeta = { noteId: "rootNote" };

            const binaryIndex = new Uint8Array([1, 2, 3]);
            mockContentRenderer.renderNoteForExport.mockReturnValue(binaryIndex as any);

            mockIconPacks.push({ prefix: "Str", fontMime: "font/ttf", fontAttachmentId: "strAtt", builtin: false });
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue({ getContent: () => "string-font-data" });

            const rootMeta: any = { noteId: "rootNote", title: "Root", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            expect(findAppend("index.html").data).toBe(binaryIndex);
            expect(findAppend("assets/icon-pack-str.ttf").data).toBe("string-font-data");
        });

        it("defaults the index title to an empty string when rootMeta has no title", () => {
            const p = makeProvider();
            (p as any).indexMeta = { dataFileName: "index.html" };
            (p as any).rootMeta = { noteId: "rootNote" };
            mockContentRenderer.renderNoteForExport.mockReturnValue("<p>x</p>");

            const rootMeta: any = { noteId: "rootNote", notePath: ["root", "rootNote12345"], attachments: [] };
            p.afterDone(rootMeta);

            expect(mockContentRenderer.renderNoteForExport).toHaveBeenCalled();
            expect(appendCalls.map((c) => c.options.name)).toContain("index.html");
        });

        it("skips the index when there is no index data file name", () => {
            const p = makeProvider();
            (p as any).indexMeta = null;
            p.afterDone({ noteId: "rootNote", title: "Root" } as any);

            expect(appendCalls.map((c) => c.options.name)).not.toContain("index.html");
            // 404 + search-index are still written.
            expect(appendCalls.map((c) => c.options.name)).toContain("404.html");
        });

        it("logs an error and skips a font when its data cannot be found", () => {
            const p = makeProvider();
            (p as any).indexMeta = null;
            mockIconPacks.push(
                { prefix: "Missing", fontMime: "font/ttf", fontAttachmentId: "gone", builtin: false },
                { prefix: "Absent", fontMime: "font/woff2", fontAttachmentId: "absent", builtin: true }
            );
            (p as any).iconPacks = mockIconPacks;
            mockBecca.getAttachment.mockReturnValue(undefined);
            readBuiltinFont.mockReturnValueOnce(undefined);

            p.afterDone({ noteId: "rootNote", title: "Root" } as any);

            expect(mockLog.error).toHaveBeenCalledTimes(2);
            const names = appendCalls.map((c) => c.options.name);
            expect(names).not.toContain("assets/icon-pack-missing.ttf");
            expect(names).not.toContain("assets/icon-pack-absent.woff2");
        });
    });
});

describe("hasMermaidDiagrams", () => {
    type FakeNote = { type: string; mime?: string; available?: boolean; content: string };

    function subtreeOf(...notes: FakeNote[]) {
        return {
            getSubtree: () => ({
                notes: notes.map(({ type, mime = "text/html", available = true, content }) => ({
                    type,
                    mime,
                    isContentAvailable: () => available,
                    getContent: () => content
                }))
            })
        } as any;
    }

    it("finds a mermaid block only in a readable text note", () => {
        const mermaid = `<pre><code class="language-mermaid">graph TD;</code></pre>`;

        expect(hasMermaidDiagrams(subtreeOf(
            { type: "text", content: "<p>root</p>" },
            { type: "text", content: mermaid }
        ))).toBe(true);
        expect(hasMermaidDiagrams(subtreeOf(
            { type: "code", content: mermaid },
            { type: "text", available: false, content: mermaid },
            { type: "text", content: `<pre><code class="language-javascript">x</code></pre>` }
        ))).toBe(false);
    });

    it("finds a fenced mermaid block only in a Markdown note", () => {
        const markdown = { type: "code", mime: "text/x-markdown" };

        const fenced = "# Title\n\n~~~ mermaid\ngraph TD;\n~~~";

        expect(hasMermaidDiagrams(subtreeOf({ ...markdown, content: fenced }))).toBe(true);
        expect(hasMermaidDiagrams(subtreeOf(
            { ...markdown, content: "Inline ```mermaid is not a fence.\n\n```js\nmermaid();\n```" },
            { type: "code", mime: "application/javascript", content: "```mermaid" }
        ))).toBe(false);
    });
});

describe("mapMermaidExportFiles", () => {
    it("maps nothing from a development manifest, which lists no built files", () => {
        expect(mapMermaidExportFiles({ entry: "/@fs/repo/apps/client/src/share_mermaid.ts", files: [] }))
            .toBeUndefined();
    });

    it("flattens the listed files into assets/client and rewrites the manifest to match", () => {
        const entry = "../../../src/share_mermaid-abc.js";
        const core = "../../../src/mermaid.core-def.js";
        const mapped = mapMermaidExportFiles({ entry, files: [ entry, core ] });
        if (!mapped) {
            throw new Error("The manifest mapped to nothing.");
        }

        expect(mapped.files).toEqual([
            { source: entry, target: "assets/client/share_mermaid-abc.js" },
            { source: core, target: "assets/client/mermaid.core-def.js" }
        ]);
        expect(mapped.manifest.path).toBe("assets/client/share_mermaid.json");
        expect(JSON.parse(mapped.manifest.content)).toEqual({
            entry: "share_mermaid-abc.js",
            files: [ "share_mermaid-abc.js", "mermaid.core-def.js" ]
        });
    });
});
