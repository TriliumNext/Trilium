// @vitest-environment jsdom
// The backlink excerpts go through DOMPurify, and happy-dom mishandles the NodeIterator traversal
// it relies on (see sanitize_content.spec.ts); jsdom matches real-browser behaviour.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import froca from "../services/froca.js";
import server from "../services/server.js";
import { buildNote } from "../test/easy-froca.js";
import { BacklinksList } from "./FloatingButtonsDefinitions.js";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

/**
 * Renders the list for a note whose single backlink carries the given excerpts, waiting for the
 * `note-map/…/backlinks` request and the froca prefetch that follows it.
 */
async function renderBacklinks(excerpts: string[]) {
    // Under a root, so that the header's NoteLink has a note path to resolve.
    buildNote({ id: "root", title: "root", children: [ { id: "source", title: "Source" }, { id: "target", title: "Target" } ] });
    const target = froca.getNoteFromCache("target");
    if (!target) throw new Error("the target note was not built");
    vi.spyOn(server, "get").mockResolvedValue([ { noteId: "source", excerpts } ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<ul><BacklinksList note={target} /></ul>, container));

    // The request resolves, then the froca prefetch it awaits, then the state commits — each step
    // needs its own act() round before the excerpts are in the DOM.
    for (let round = 0; round < 3; round++) {
        await act(async () => {});
    }
    return container;
}

describe("BacklinksList", () => {
    it("strips event handlers from an excerpt while keeping its link and prose", async () => {
        const excerpt = `<div class="ck-content backlink-excerpt"><p onmouseover="window.xss=1"`
            + ` onanimationstart="window.xss=1" style="animation:1s spin">See`
            + ` <a href="#root/abcdefghijkl" class="backlink-link">the other note</a>.</p></div>`;

        const paragraph = (await renderBacklinks([ excerpt ])).querySelector("p");
        expect(paragraph?.getAttribute("onmouseover")).toBeNull();
        expect(paragraph?.getAttribute("onanimationstart")).toBeNull();
        expect(paragraph?.textContent).toBe("See the other note.");
        expect(paragraph?.querySelector("a")?.getAttribute("href")).toBe("#root/abcdefghijkl");
    });

    it("drops a script tag from an excerpt", async () => {
        const excerpt = `<div class="ck-content backlink-excerpt"><script>window.xss=1</script>`
            + `<p><a href="#root/abcdefghijkl">link</a></p></div>`;

        const rendered = await renderBacklinks([ excerpt ]);
        expect(rendered.querySelector("script")).toBeNull();
        expect(rendered.querySelector("a")?.textContent).toBe("link");
    });
});
