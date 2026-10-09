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
        const fakeMermaid = stubMermaid();
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

    it("draws a Mermaid note in place of its saved image and keeps the source block", async () => {
        const fakeMermaid = stubMermaid();
        document.body.innerHTML = MERMAID_NOTE;

        await setupMermaid();

        const container = document.querySelector("#content > .mermaid-note");
        const diagram = container?.querySelector(":scope > .mermaid");
        expect(container?.querySelector("img")).toBeNull();
        expect(diagram?.textContent).toBe("graph TD; A-->B");
        expect(container?.querySelector("details pre.mermaid-note-source")).not.toBeNull();
        expect(fakeMermaid.run).toHaveBeenLastCalledWith({ nodes: [ diagram ] });
    });

    it("keeps a Mermaid note's saved image when Mermaid cannot be loaded", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        document.body.innerHTML = MERMAID_NOTE;

        await expect(setupMermaid()).rejects.toThrow("HTTP 404");

        expect(document.querySelector(".mermaid-note > img.mermaid-note-image")).not.toBeNull();
        expect(document.querySelector(".mermaid")).toBeNull();
    });
});

const MERMAID_NOTE = `<div id="content"><div class="mermaid-note">`
    + `<img class="mermaid-note-image" src="api/images/abc/diagram">`
    + `<hr><details><summary>Chart source</summary>`
    + `<pre class="mermaid-note-source">graph TD; A--&gt;B</pre></details>`
    + `</div></div>`;

let stubCount = 0;

/** Serves a fake Mermaid, at a URL of its own: modules are cached by URL. */
function stubMermaid() {
    const fakeMermaid = { initialize: vi.fn(), run: vi.fn(async () => {}) };
    vi.stubGlobal("fakeMermaid", fakeMermaid);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        entry: `data:text/javascript,export default globalThis.fakeMermaid; // ${++stubCount}`
    }))));
    return fakeMermaid;
}
