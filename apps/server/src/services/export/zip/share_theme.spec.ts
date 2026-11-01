import { beforeEach, describe, expect, it, vi } from "vitest";

const MANIFEST = vi.hoisted(() => ({
    files: [ "scripts.js", "scripts.css" ],
    lazy: { mermaid: [ "mermaid.core-a.js", "../assets/worker-b.js" ] },
    requires: {}
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
        expect(decode(files.get("assets/worker-b.js")))
            .toBe("content of /client-build/assets/worker-b.js");
    });

    it("adds the app's catalogues an app view reads, leaving out one the locale lacks", () => {
        mockFs.existsSync.mockImplementation((path: string) => !path.endsWith("entry.json"));
        const calendar = {
            type: "book",
            getLabelValue: () => "calendar",
            getChildNotes: () => [],
            isContentAvailable: () => true,
            getContent: () => ""
        };
        const { files } = createAssets("<p>No diagrams.</p>", calendar);

        expect(decode(files.get("assets/translations/en/translation.json")))
            .toBe("content of /client/translations/en/translation.json");
        expect(files.has("assets/translations/en/entry.json")).toBe(false);
        const withoutViews = createAssets("<p>No diagrams.</p>");
        expect(withoutViews.files.has("assets/translations/en/translation.json")).toBe(false);
    });

    it("fails without a client build to read the share theme from", () => {
        mockFs.existsSync.mockReturnValue(false);

        expect(() => createAssets("<p>No diagrams.</p>")).toThrow("share_theme.json is missing");
    });
});

const MERMAID_BLOCK = `<pre><code class="language-mermaid">graph TD;</code></pre>`;

function createAssets(content: string, ...others: object[]) {
    const note = {
        getSubtree: () => ({
            notes: [
                { type: "text", isContentAvailable: () => true, getContent: () => content },
                ...others
            ]
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
