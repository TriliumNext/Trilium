import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMermaid } from "./mermaid.js";

describe("loadMermaid", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("imports the entry the manifest next to the script names", async () => {
        const fetchMock = vi.fn(async (_url: URL) => new Response(JSON.stringify({
            entry: `data:text/javascript,export default { name: "client mermaid" };`,
            files: []
        })));
        vi.stubGlobal("fetch", fetchMock);

        expect(await loadMermaid()).toEqual({ name: "client mermaid" });
        expect(fetchMock.mock.calls[0][0].href)
            .toBe(new URL("client/share_mermaid.json", import.meta.url).href);
    });

    it("fails when the manifest is missing", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

        await expect(loadMermaid()).rejects.toThrow("HTTP 404");
    });
});
