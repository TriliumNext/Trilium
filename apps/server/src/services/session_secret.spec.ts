import { afterEach, describe, expect, it, vi } from "vitest";

describe("session_secret", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("fs");
        vi.doUnmock("./data_dir.js");
        vi.doUnmock("./utils.js");
        vi.doUnmock("@triliumnext/core");
        vi.restoreAllMocks();
    });

    async function loadSecret(opts: { exists: boolean }) {
        vi.resetModules();
        const writeFileSync = vi.fn();
        const readFileSync = vi.fn(() => "secret-from-file");
        const info = vi.fn();
        vi.doMock("fs", () => ({
            default: { existsSync: () => opts.exists, writeFileSync, readFileSync }
        }));
        vi.doMock("./data_dir.js", () => ({ default: { TRILIUM_DATA_DIR: "/test/data" } }));
        vi.doMock("./utils.js", () => ({
            // Return MORE than `len` chars so the source's `.slice(0, 64)` is
            // actually exercised (real randomSecureToken returns a longer hex string).
            randomSecureToken: (len: number) => "g".repeat(len * 2)
        }));
        vi.doMock("@triliumnext/core", () => ({ getLog: () => ({ info }) }));

        const secret = (await import("./session_secret.js")).default;
        return { secret, writeFileSync, readFileSync, info };
    }

    it("generates, logs and persists a 64-char secret when none exists", async () => {
        const { secret, writeFileSync, info } = await loadSecret({ exists: false });
        // Truncated from the longer token to exactly 64 chars by the slice.
        expect(secret).toHaveLength(64);
        expect(info).toHaveBeenCalledOnce();
        expect(writeFileSync).toHaveBeenCalledWith(
            "/test/data/session_secret.txt",
            secret,
            "ascii"
        );
    });

    it("reads the existing secret from disk", async () => {
        const { secret, readFileSync, writeFileSync, info } = await loadSecret({ exists: true });
        expect(secret).toBe("secret-from-file");
        expect(readFileSync).toHaveBeenCalledWith("/test/data/session_secret.txt", "ascii");
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
    });
});
