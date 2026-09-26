import { beforeEach, describe, expect, it, vi } from "vitest";

const MANIFEST = vi.hoisted(() => ({
    entry: "share_mermaid-a.js",
    files: [ "share_mermaid-a.js", "core-b.js" ]
}));

const mockFs = vi.hoisted(() => ({
    existsSync: vi.fn((_path: string) => true),
    readdirSync: vi.fn(() => [ "styles.css", "scripts.js" ]),
    readFileSync: vi.fn((path: string) => {
        const normalized = path.split("\\").join("/");
        if (normalized.endsWith("share_mermaid.json")) {
            return JSON.stringify(MANIFEST);
        }
        return new TextEncoder().encode(`content of ${normalized}`);
    })
}));
vi.mock("fs", () => ({ default: mockFs, ...mockFs }));

vi.mock("../../../routes/assets", () => ({
    getClientBuildDir: () => "/client-build",
    getClientDir: () => "/client",
    getShareThemeAssetDir: () => "/share-assets"
}));
vi.mock("../../resource_dir", () => ({ RESOURCE_DIR: "/resource" }));

const registerShareProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../share/share_provider.js", () => ({ registerShareProvider }));

const mockLog = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@triliumnext/core/src/services/log.js", () => ({ getLog: () => mockLog }));

const { createShareThemeExportProvider } = await import("./share_theme.js");

describe("createShareThemeExportProvider", () => {
    beforeEach(() => {
        mockFs.existsSync.mockReturnValue(true);
        mockLog.info.mockClear();
    });

    it("reads the share theme's files and the built-in fonts from disk", () => {
        const { files, readBuiltinFont } = createAssets("<p>No diagrams.</p>");

        expect(registerShareProvider).toHaveBeenCalled();
        expect([ ...files.keys() ]).toEqual([ "icon-color.svg", "assets/styles.css", "assets/scripts.js" ]);
        expect(decode(files.get("icon-color.svg"))).toBe("content of /resource/images/icon-color.svg");
        expect(decode(files.get("assets/scripts.js"))).toBe("content of /share-assets/scripts.js");
        expect(decode(readBuiltinFont("boxicons.woff2"))).toBe("content of /client/fonts/boxicons.woff2");
    });

    it("copies the client's mermaid from its manifest when a note has a diagram", () => {
        const { files } = createAssets(MERMAID_BLOCK);

        expect(JSON.parse(String(files.get("assets/client/share_mermaid.json")))).toEqual(MANIFEST);
        for (const file of MANIFEST.files) {
            expect(decode(files.get(`assets/client/${file}`)))
                .toBe(`content of /client-build/src/${file}`);
        }
    });

    it("exports without mermaid when the client build has no manifest", () => {
        mockFs.existsSync.mockReturnValue(false);
        const { files } = createAssets(MERMAID_BLOCK);

        expect([ ...files.keys() ].filter((name) => name.startsWith("assets/client/"))).toEqual([]);
        expect(mockLog.info)
            .toHaveBeenCalledWith(expect.stringContaining("share_mermaid.json is missing"));
    });
});

const MERMAID_BLOCK = `<pre><code class="language-mermaid">graph TD;</code></pre>`;

function createAssets(content: string) {
    const note = {
        getSubtree: () => ({
            notes: [ { type: "text", isContentAvailable: () => true, getContent: () => content } ]
        })
    };
    const provider = createShareThemeExportProvider({ branch: { getNote: () => note } } as never);
    return (provider as unknown as { assets: {
        files: Map<string, string | Uint8Array>;
        readBuiltinFont(fileName: string): Uint8Array | undefined;
    } }).assets;
}

function decode(data: string | Uint8Array | undefined) {
    return typeof data === "string" ? data : new TextDecoder().decode(data);
}
