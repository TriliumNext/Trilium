import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("resource_dir", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("fs");
        vi.doUnmock("./utils.js");
        vi.restoreAllMocks();
    });

    async function loadResourceDir(dbInitDirExists: boolean) {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ getResourceDir: () => "/test/root" }));
        vi.doMock("fs", () => ({ default: { existsSync: () => dbInitDirExists } }));
        return (await import("./resource_dir.js")).default;
    }

    it("computes resource directories when the DB init dir exists", async () => {
        const dirs = await loadResourceDir(true);
        expect(dirs.RESOURCE_DIR).toBe(path.join("/test/root", "assets"));
        expect(dirs.DB_INIT_DIR).toBe(path.resolve(dirs.RESOURCE_DIR, "db"));
        expect(dirs.ELECTRON_APP_ROOT_DIR).toBe(path.resolve(dirs.RESOURCE_DIR, "../.."));
    });

    it("exits when the DB init directory is missing", async () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("exit");
        }) as never);
        vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(loadResourceDir(false)).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
