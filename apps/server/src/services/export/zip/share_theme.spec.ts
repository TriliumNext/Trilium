import { beforeEach, describe, expect, it, vi } from "vitest";

const MANIFEST = vi.hoisted(() => ({
    files: [ "scripts.js", "scripts.css" ],
    lazy: { mermaid: [ "mermaid.core-a.js" ] }
}));

const mockFs = vi.hoisted(() => ({
    existsSync: vi.fn((_path: string) => true),
    readFileSync: vi.fn((path: string) => {
        const normalized = path.split("\\").join("/");
        if (normalized.endsWith("share_theme.json")) {
            return JSON.stringify(MANIFEST);
        }
        return new TextEncoder().encode(`content of ${normalized}`);
    })
}));
vi.mock("fs", () => ({ default: mockFs, ...mockFs }));

vi.mock("../../../routes/assets", () => ({
    getClientDir: () => "/client",
    getShareThemeAssetDir: () => "/client-build/src"
}));
vi.mock("../../resource_dir", () => ({ RESOURCE_DIR: "/resource" }));

const registerShareProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../share/share_provider.js", () => ({ registerShareProvider }));

const { createShareThemeExportProvider } = await import("./share_theme.js");

describe("createShareThemeExportProvider", () => {
    beforeEach(() => {
        mockFs.existsSync.mockReturnValue(true);
    });

    it("reads the files the manifest lists and the built-in fonts from disk", () => {
        const { files, readBuiltinFont } = createAssets("<p>No diagrams.</p>");

        expect(registerShareProvider).toHaveBeenCalled();
        expect([ ...files.keys() ])
            .toEqual([ "icon-color.svg", "assets/scripts.js", "assets/scripts.css" ]);
        expect(decode(files.get("icon-color.svg"))).toBe("content of /resource/images/icon-color.svg");
        expect(decode(files.get("assets/scripts.js")))
            .toBe("content of /client-build/src/scripts.js");
        expect(decode(readBuiltinFont("boxicons.woff2"))).toBe("content of /client/fonts/boxicons.woff2");
    });

    it("adds the files of mermaid when a note has a diagram", () => {
        const { files } = createAssets(MERMAID_BLOCK);

        expect(decode(files.get("assets/mermaid.core-a.js")))
            .toBe("content of /client-build/src/mermaid.core-a.js");
    });

    it("fails without a client build to read the share theme from", () => {
        mockFs.existsSync.mockReturnValue(false);

        expect(() => createAssets("<p>No diagrams.</p>")).toThrow("share_theme.json is missing");
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
