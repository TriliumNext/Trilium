import { describe, expect, it, vi } from "vitest";

const mockFs = vi.hoisted(() => ({
    readdirSync: vi.fn(() => [ "styles.css", "scripts.js" ]),
    readFileSync: vi.fn((path: string) => new TextEncoder().encode(`content of ${path.split("\\").join("/")}`))
}));
vi.mock("fs", () => ({ default: mockFs, ...mockFs }));

vi.mock("../../../routes/assets", () => ({
    getClientDir: () => "/client",
    getShareThemeAssetDir: () => "/share-assets"
}));
vi.mock("../../resource_dir", () => ({ RESOURCE_DIR: "/resource" }));

const registerShareProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../share/share_provider.js", () => ({ registerShareProvider }));

const { createShareThemeExportProvider } = await import("./share_theme.js");

describe("createShareThemeExportProvider", () => {
    it("reads the share theme's files and the built-in fonts from disk", () => {
        const provider = createShareThemeExportProvider({ branch: {} } as never);
        const { files, readBuiltinFont } = (provider as unknown as { assets: {
            files: Map<string, Uint8Array>;
            readBuiltinFont(fileName: string): Uint8Array | undefined;
        } }).assets;
        const decode = (data: Uint8Array | undefined) => new TextDecoder().decode(data);

        expect(registerShareProvider).toHaveBeenCalled();
        expect([ ...files.keys() ]).toEqual([ "icon-color.svg", "assets/styles.css", "assets/scripts.js" ]);
        expect(decode(files.get("icon-color.svg"))).toBe("content of /resource/images/icon-color.svg");
        expect(decode(files.get("assets/scripts.js"))).toBe("content of /share-assets/scripts.js");
        expect(decode(readBuiltinFont("boxicons.woff2"))).toBe("content of /client/fonts/boxicons.woff2");
    });
});
