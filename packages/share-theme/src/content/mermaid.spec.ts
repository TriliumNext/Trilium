// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupMermaid, { loadMermaid } from "./mermaid.js";

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

describe("setupMermaid", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.documentElement.removeAttribute("style");
        document.documentElement.removeAttribute("class");
        document.body.innerHTML = "";
    });

    it("draws diagrams in the page's Mermaid theme and again when the theme changes", async () => {
        const fakeMermaid = { initialize: vi.fn(), run: vi.fn(async () => {}) };
        vi.stubGlobal("fakeMermaid", fakeMermaid);
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            entry: "data:text/javascript,export default globalThis.fakeMermaid;"
        }))));
        document.body.innerHTML = `<div id="content"><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre></div>`;
        document.documentElement.style.setProperty("--mermaid-theme", "dark");

        await setupMermaid();

        const diagram = document.querySelector("#content > .mermaid");
        expect(diagram?.textContent).toBe("graph TD; A-->B");
        expect(fakeMermaid.initialize).toHaveBeenLastCalledWith(
            expect.objectContaining({ theme: "dark", layout: "dagre", startOnLoad: false }));
        expect(fakeMermaid.run).toHaveBeenLastCalledWith({ nodes: [ diagram ] });

        // A class change that leaves the theme alone does not draw the diagrams again.
        document.documentElement.classList.add("left-pane-collapsed");
        await Promise.resolve();
        expect(fakeMermaid.run).toHaveBeenCalledTimes(1);

        document.documentElement.style.setProperty("--mermaid-theme", "default");
        document.documentElement.classList.add("theme-light");
        await vi.waitFor(() => expect(fakeMermaid.run).toHaveBeenCalledTimes(2));
        expect(fakeMermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default" }));
        expect(diagram?.textContent).toBe("graph TD; A-->B");
    });
});
