import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAnonymizedCopy } = vi.hoisted(() => ({
    createAnonymizedCopy: vi.fn()
}));

vi.mock("./services/anonymization.js", () => ({ default: { createAnonymizedCopy } }));
vi.mock("./services/sql_init.js", () => ({ default: { dbReady: Promise.resolve() } }));
vi.mock("@triliumnext/core", () => ({}));

/** `anonymize.ts` is a script: importing it runs the anonymization once the database is ready. */
async function runScript() {
    vi.resetModules();
    await import("./anonymize.js");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalled());
}

describe("anonymize script", () => {
    beforeEach(() => {
        createAnonymizedCopy.mockReset();
        vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it("writes a full anonymized copy and exits successfully", async () => {
        createAnonymizedCopy.mockResolvedValue({ success: true, anonymizedFilePath: "/data/anonymized-db/a.db" });

        await runScript();

        expect(createAnonymizedCopy).toHaveBeenCalledWith("full");
        expect(console.log).toHaveBeenCalledWith("Anonymized file has been saved to: /data/anonymized-db/a.db");
        expect(vi.mocked(process.exit).mock.calls[0]).toEqual([ 0 ]);
    });

    it("exits with an error when the anonymization fails or throws", async () => {
        createAnonymizedCopy.mockResolvedValue({ success: false });

        await runScript();

        expect(console.log).toHaveBeenLastCalledWith("Anonymization failed.");
        expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);

        vi.mocked(process.exit).mockClear();
        const error = new Error("disk full");
        createAnonymizedCopy.mockRejectedValue(error);

        await runScript();

        expect(console.error).toHaveBeenCalledWith("disk full", error.stack);
        expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    });
});
