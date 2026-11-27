import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

const h = vi.hoisted(() => ({
    calls: [] as string[],
    appListeners: new Map<string, Listener>(),
    enableCompileCache: vi.fn(),
    flushCompileCache: vi.fn()
}));

vi.mock("electron", () => ({
    app: {
        getPath: (name: string) => `/home/user/.config-${name}`,
        once: (event: string, listener: Listener) => h.appListeners.set(event, listener)
    }
}));

vi.mock("node:module", () => ({
    enableCompileCache: (dir: string) => {
        h.calls.push("enableCompileCache");
        h.enableCompileCache(dir);
    },
    flushCompileCache: () => h.flushCompileCache()
}));

vi.mock("./main.js", () => {
    h.calls.push("main");
    return {};
});

describe("desktop entry", () => {
    beforeEach(() => {
        h.calls.length = 0;
        h.appListeners.clear();
        h.enableCompileCache.mockClear();
        h.flushCompileCache.mockClear();
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it("turns on the compile cache before it loads the main bundle", async () => {
        vi.stubEnv("TRILIUM_ELECTRON_DATA_DIR", "");
        await import("./entry.js");

        expect(h.calls).toEqual([ "enableCompileCache", "main" ]);
        expect(h.enableCompileCache).toHaveBeenCalledWith(
            path.join("/home/user/.config-appData", "trilium-compile-cache"));
    });

    it("keeps the cache in the Electron data directory of a portable install", async () => {
        vi.stubEnv("TRILIUM_ELECTRON_DATA_DIR", "/portable/electron-data");
        await import("./entry.js");

        expect(h.enableCompileCache).toHaveBeenCalledWith(
            path.join(path.resolve("/portable/electron-data"), "compile-cache"));
    });

    it("writes the cache once the first page has loaded", async () => {
        await import("./entry.js");

        const onWebContentsCreated = h.appListeners.get("web-contents-created");
        expect(onWebContentsCreated).toBeDefined();
        if (!onWebContentsCreated) return;

        const pageListeners = new Map<string, Listener>();
        onWebContentsCreated({}, { once: (event: string, listener: Listener) => pageListeners.set(event, listener) });
        expect(h.flushCompileCache).not.toHaveBeenCalled();

        pageListeners.get("did-finish-load")?.();
        expect(h.flushCompileCache).toHaveBeenCalledTimes(1);
    });
});
