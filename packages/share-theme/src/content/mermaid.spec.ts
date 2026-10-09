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
        const firstId = diagram?.querySelector("svg")?.id;
        expect(document.querySelector("#content pre")).toBeNull();
        expect(firstId).toMatch(/^share-mermaid-\d+$/);
        expect(fakeMermaid.initialize).toHaveBeenLastCalledWith(
            expect.objectContaining({ theme: "dark", layout: "dagre", startOnLoad: false }));
        expect(fakeMermaid.render).toHaveBeenLastCalledWith(firstId, "graph TD; A-->B");

        // A class change that leaves the theme alone does not draw the diagrams again.
        document.documentElement.classList.add("menu-open");
        await Promise.resolve();
        expect(fakeMermaid.render).toHaveBeenCalledTimes(1);

        document.documentElement.style.setProperty("--mermaid-theme", "default");
        document.documentElement.classList.add("theme-light");
        await vi.waitFor(() => expect(fakeMermaid.render).toHaveBeenCalledTimes(2));
        expect(fakeMermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default" }));
        expect(document.querySelector("#content > .mermaid")).toBe(diagram);
        expect(diagram?.querySelectorAll("svg")).toHaveLength(1);
        expect(diagram?.querySelector("svg")?.id).not.toBe(firstId);
    });

    it("draws a Mermaid note in place of its saved image and keeps the source block", async () => {
        const fakeMermaid = stubMermaid();
        document.body.innerHTML = MERMAID_NOTE;

        await setupMermaid();

        const container = document.querySelector("#content > .mermaid-note");
        expect(container?.querySelector("img")).toBeNull();
        expect(container?.querySelectorAll(":scope > .mermaid > svg")).toHaveLength(1);
        expect(container?.querySelector("details pre.mermaid-note-source")).not.toBeNull();
        expect(fakeMermaid.render).toHaveBeenLastCalledWith(expect.any(String), "graph TD; A-->B");
    });

    it("keeps what a diagram replaces until Mermaid draws it, and draws every diagram again on a theme change", async () => {
        const fakeMermaid = stubMermaid();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        document.body.innerHTML = `<div id="content"><div class="mermaid-note">`
            + `<img class="mermaid-note-image" src="api/images/abc/diagram">`
            + `<pre class="mermaid-note-source">broken</pre></div>`
            + `<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre></div>`;

        await setupMermaid();

        expect(document.querySelector("#content > .mermaid-note > img.mermaid-note-image")).not.toBeNull();
        expect(document.querySelectorAll("#content > .mermaid > svg")).toHaveLength(1);
        expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "Parse error" }));

        document.documentElement.style.setProperty("--mermaid-theme", "dark");
        document.documentElement.classList.add("theme-dark");
        await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
        expect(fakeMermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
        expect(fakeMermaid.render.mock.calls.map(([ , source ]) => source))
            .toStrictEqual([ "graph TD; A-->B", "broken", "graph TD; A-->B", "broken" ]);
        expect(document.querySelector("#content > .mermaid-note > img.mermaid-note-image")).not.toBeNull();
        expect(document.querySelectorAll("#content > .mermaid > svg")).toHaveLength(1);

        // Back to the default theme, so that `afterEach` does not start another drawing.
        document.documentElement.style.removeProperty("--mermaid-theme");
        document.documentElement.classList.remove("theme-dark");
        await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(3));
        consoleError.mockRestore();
    });

    it("keeps a Mermaid note's saved image when Mermaid cannot be loaded", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        document.body.innerHTML = MERMAID_NOTE;

        await expect(setupMermaid()).rejects.toThrow("HTTP 404");

        expect(document.querySelector(".mermaid-note > img.mermaid-note-image")).not.toBeNull();
        expect(document.querySelector(".mermaid")).toBeNull();
    });
});

describe("setupMermaid without diagrams", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("loads nothing for other code blocks or a Mermaid note without its source", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        document.body.innerHTML = `<div id="content">`
            + `<pre><code class="language-javascript">graph TD;</code></pre>`
            + `<div class="mermaid-note"><img class="mermaid-note-image" src="diagram.svg"></div>`
            + `</div>`;

        await setupMermaid();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(document.querySelectorAll("#content pre, #content img")).toHaveLength(2);
    });
});

const MERMAID_NOTE =`<div id="content"><div class="mermaid-note">`
    + `<img class="mermaid-note-image" src="api/images/abc/diagram">`
    + `<hr><details><summary>Chart source</summary>`
    + `<pre class="mermaid-note-source">graph TD; A--&gt;B</pre></details>`
    + `</div></div>`;

let stubCount = 0;

/**
 * Serves a fake Mermaid, at a URL of its own: modules are cached by URL. It cannot draw a source
 * containing `broken`.
 */
function stubMermaid() {
    const fakeMermaid = {
        initialize: vi.fn(),
        render: vi.fn(async (id: string, source: string) => {
            if (source.includes("broken")) {
                throw new Error("Parse error");
            }
            return { svg: `<svg id="${id}"></svg>` };
        })
    };
    vi.stubGlobal("fakeMermaid", fakeMermaid);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        entry: `data:text/javascript,export default globalThis.fakeMermaid; // ${++stubCount}`
    }))));
    return fakeMermaid;
}
