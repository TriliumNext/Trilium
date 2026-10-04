import { beforeEach, describe, expect, it, vi } from "vitest";

const findOnPathMock = vi.hoisted(() => vi.fn<(binary: string) => Promise<string | undefined>>());
vi.mock("./binary_lookup.js", async (importOriginal) => ({ ...await importOriginal<typeof import("./binary_lookup.js")>(), findOnPath: findOnPathMock }));

const { buildHookCommand, resetCurlCache, resolveCurlPath, stringsIn } = await import("./acp_hook.js");

describe("buildHookCommand", () => {
    it("posts the tool call to Trilium and fails on anything but a decision", () => {
        expect(buildHookCommand("C:\\Windows\\System32\\curl.exe", "http://127.0.0.1:5000/hook-abc"))
            .toBe("\"C:\\Windows\\System32\\curl.exe\" --silent --show-error --fail --noproxy 127.0.0.1 --max-time 8 --data-binary @- http://127.0.0.1:5000/hook-abc");
        expect(() => buildHookCommand("/opt/\"odd\"/curl", "http://127.0.0.1:5000/hook-abc")).toThrow(/quote/);
    });
});

describe("resolveCurlPath", () => {
    beforeEach(() => {
        resetCurlCache();
        findOnPathMock.mockReset();
    });

    it("finds curl once, and explains what to install when it is missing", async () => {
        findOnPathMock.mockResolvedValueOnce(undefined);
        await expect(resolveCurlPath()).rejects.toThrow(/Google Antigravity and OpenAI Codex providers need curl.*Install curl/s);

        findOnPathMock.mockResolvedValue("/usr/bin/curl");
        await expect(resolveCurlPath()).resolves.toBe("/usr/bin/curl");
        await expect(resolveCurlPath()).resolves.toBe("/usr/bin/curl");
        expect(findOnPathMock).toHaveBeenCalledTimes(2);
        expect(findOnPathMock).toHaveBeenCalledWith("curl");
    });
});

describe("stringsIn", () => {
    it("collects every string, however deeply nested, and nothing else", () => {
        expect(stringsIn({ open: [ { ref_id: "a" } ], n: 3, flag: true, nested: { list: [ "b", [ "c" ] ] } })).toEqual([ "a", "b", "c" ]);
        expect(stringsIn("d")).toEqual([ "d" ]);
        expect(stringsIn(null)).toEqual([]);
    });
});
