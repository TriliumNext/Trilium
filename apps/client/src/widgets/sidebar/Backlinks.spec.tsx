// @vitest-environment jsdom
// The backlink excerpts go through DOMPurify, and happy-dom mishandles the NodeIterator traversal
// it relies on (see sanitize_content.spec.ts); jsdom matches real-browser behaviour.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component.js";
import froca from "../../services/froca.js";
import LoadResults from "../../services/load_results.js";
import server from "../../services/server.js";
import { buildNote } from "../../test/easy-froca.js";
import { ParentComponent } from "../react/react_utils.js";
import { BacklinksList } from "./Backlinks.js";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.restoreAllMocks();
});

/**
 * Renders the list for a note whose single backlink carries the given excerpts, waiting for the
 * `note-map/…/backlinks` request and the froca prefetch that follows it.
 */
async function renderBacklinks(excerpts: string[], parent = new Component()) {
    // Under a root, so that the header's NoteLink has a note path to resolve.
    buildNote({ id: "root", title: "root", children: [ { id: "source", title: "Source" }, { id: "target", title: "Target" } ] });
    const target = froca.getNoteFromCache("target");
    if (!target) throw new Error("the target note was not built");
    vi.spyOn(server, "get").mockResolvedValue([ { noteId: "source", excerpts } ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(
        <ParentComponent.Provider value={parent}>
            <ul><BacklinksList note={target} /></ul>
        </ParentComponent.Provider>,
        container
    ));
    await settle();
    return container;
}

/** The request resolves, then the froca prefetch it awaits, then the state commits. */
async function settle() {
    for (let round = 0; round < 3; round++) {
        await act(async () => {});
    }
}

/** Announces a relation change the way a websocket message reaches the widgets. */
async function reloadRelation(
    parent: Component, attribute: { noteId: string; value: string; isDeleted?: boolean }
) {
    const attributeId = `${attribute.noteId}-${attribute.value}`;
    const entity = { attributeId, type: "relation", name: "internalLink", isDeleted: false, ...attribute };
    const loadResults = new LoadResults([ {
        entityName: "attributes", entityId: attributeId, entity, hash: "", isSynced: true, isErased: false
    } ]);
    loadResults.addAttribute(attributeId, "someOtherComponent");

    await act(async () => {
        await parent.handleEvent("entitiesReloaded", { loadResults });
    });
    await settle();
}

describe("BacklinksList", () => {
    it("fetches the list again when a relation pointing at the note changes, not one it owns", async () => {
        const parent = new Component();
        await renderBacklinks([], parent);
        const get = vi.mocked(server.get);

        const refreshes: boolean[] = [];
        for (const attribute of [
            { noteId: "target", value: "elsewhere" },
            { noteId: "source", value: "target" },
            { noteId: "source", value: "target", isDeleted: true }
        ]) {
            get.mockClear();
            await reloadRelation(parent, attribute);
            refreshes.push(get.mock.calls.length > 0);
        }
        expect(refreshes).toEqual([ false, true, true ]);
    });

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
