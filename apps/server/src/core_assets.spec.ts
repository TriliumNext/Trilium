import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

const mockFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn()
};
vi.mock("fs", () => ({ default: mockFs, ...mockFs }));
vi.mock("./services/resource_dir.js", () => ({ RESOURCE_DIR: "/test/res" }));

const { loadCoreSchema, loadSkillSheet } = await import("./core_assets.js");

afterEach(() => vi.clearAllMocks());

describe("loadCoreSchema", () => {
    it("reads the bundled schema from the resource dir in production", () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue("PROD SCHEMA");

        expect(loadCoreSchema()).toBe("PROD SCHEMA");
        expect(mockFs.existsSync).toHaveBeenCalledWith(path.join("/test/res", "schema.sql"));
        expect(mockFs.readFileSync).toHaveBeenCalledWith(path.join("/test/res", "schema.sql"), "utf-8");
    });

    it("falls back to the core package schema in dev when the bundled file is absent", () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.readFileSync.mockReturnValue("DEV SCHEMA");

        expect(loadCoreSchema()).toBe("DEV SCHEMA");
        // The fallback resolves the schema from the trilium-core package.
        const [resolvedPath] = mockFs.readFileSync.mock.calls[0];
        expect(String(resolvedPath)).toContain("schema.sql");
        expect(String(resolvedPath)).toContain("trilium-core");
    });
});

describe("loadSkillSheet", () => {
    it("reads the bundled sheet from the resource dir in production", () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue("# Search syntax");

        expect(loadSkillSheet("search_syntax.md")).toBe("# Search syntax");
        expect(mockFs.readFileSync)
            .toHaveBeenCalledWith(path.join("/test/res", "llm", "skills", "search_syntax.md"), "utf-8");
    });

    it("falls back to the core package sheet in dev, where nothing has been copied", () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.readFileSync.mockReturnValue("# Search syntax");

        expect(loadSkillSheet("search_syntax.md")).toBe("# Search syntax");
        const [resolvedPath] = mockFs.readFileSync.mock.calls[0];
        expect(String(resolvedPath)).toContain(path.join("trilium-core", "src", "assets", "llm", "skills"));
    });

    it("refuses a name that could climb out of the skills directory", () => {
        // The name comes from core's catalog rather than from a user, but it is
        // interpolated into a path, so it is checked where it is used.
        for (const name of [ "../../../etc/passwd", "nested/sheet.md", "..\\windows.md" ]) {
            expect(loadSkillSheet(name), name).toBeNull();
        }
        expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it("answers with nothing rather than throwing when the sheet cannot be read", () => {
        // One missing sheet costs the model a tool call; it must not fail the chat.
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation(() => { throw new Error("EACCES"); });

        expect(loadSkillSheet("search_syntax.md")).toBeNull();
    });
});
