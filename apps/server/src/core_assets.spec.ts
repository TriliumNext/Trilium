import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

const mockFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn()
};
vi.mock("fs", () => ({ default: mockFs, ...mockFs }));
vi.mock("./services/resource_dir.js", () => ({ RESOURCE_DIR: "/test/res" }));

const { loadCoreSchema } = await import("./core_assets.js");

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
