import type { NodeObj, Topic } from "mind-elixir";
import { describe, expect, it } from "vitest";

import { getNodeMemo, MEMO_MARKER_ATTRIBUTE, renderMemoMarkers, toMemoHtml } from "./NodeMemo";

function buildNode(node: Partial<NodeObj> = {}): NodeObj {
    return { id: "n1", topic: "Node", ...node };
}

/**
 * A map of nodes as Mind Elixir renders them: an element each, carrying the node it stands for —
 * which is where the pass reads a memo from, the memo being nowhere on the page.
 */
function buildMap(...nodes: Partial<NodeObj>[]) {
    const container = document.createElement("div");

    for (const [ index, node ] of nodes.entries()) {
        const topic = document.createElement("me-tpc") as Topic;
        topic.nodeObj = { id: `n${index}`, topic: "Node", ...node } as NodeObj;
        container.appendChild(topic);
    }

    return container;
}

function markedNodes(container: HTMLElement) {
    return [ ...container.querySelectorAll<Topic>("me-tpc") ]
        .filter((topic) => topic.hasAttribute(MEMO_MARKER_ATTRIBUTE))
        .map((topic) => topic.nodeObj.id);
}

describe("the memo of a node", () => {
    it("is read from the field the node menu wrote, which Mind Elixir has no say over", () => {
        // Its own `note` field is a different one, never written here: reading that instead would
        // leave every memo written before this panel unseen.
        expect(getNodeMemo(buildNode({ memo: "Ask about this" } as Partial<NodeObj>))).toBe("Ask about this");
        expect(getNodeMemo(buildNode({ note: "elsewhere" } as Partial<NodeObj>))).toBeUndefined();
        expect(getNodeMemo(buildNode())).toBeUndefined();
    });

    it("survives being taken into an editor, however it was written", () => {
        // Written through the textarea this replaces, a memo is plain text: read as HTML, a `<`
        // would swallow what follows it and the memo would come back shorter than it went in.
        expect(toMemoHtml("2 < 3 & counting")).toBe("<p>2 &lt; 3 &amp; counting</p>");
        expect(toMemoHtml("first\nsecond")).toBe("<p>first</p><p>second</p>");
        // Written through the editor, it is HTML already and is handed over as it stands.
        expect(toMemoHtml("<p>Ask <strong>about</strong> this</p>")).toBe("<p>Ask <strong>about</strong> this</p>");
        expect(toMemoHtml(null)).toBe("");
        expect(toMemoHtml("")).toBe("");
    });
});

describe("renderMemoMarkers", () => {
    it("marks the nodes there is something written about, and only those", () => {
        const container = buildMap(
            { memo: "<p>About the first</p>" } as Partial<NodeObj>,
            {},
            // Written through the textarea this replaces, a memo is plain text rather than markup.
            { memo: "Ask about this" } as Partial<NodeObj>,
            // Emptied down to nothing is carrying none: the editor hands back an empty string, and
            // the panel's own tab reads that the same way.
            { memo: "" } as Partial<NodeObj>
        );

        renderMemoMarkers(container);

        expect(markedNodes(container)).toEqual([ "n0", "n2" ]);
    });

    it("takes the mark off a node whose memo is taken away", () => {
        // The pass runs after every layout, over nodes it has already been over: what it puts on it
        // must also take off, or a memo cleared would leave the map saying there is one to read.
        const container = buildMap({ memo: "<p>About it</p>" } as Partial<NodeObj>);
        renderMemoMarkers(container);
        expect(markedNodes(container)).toEqual([ "n0" ]);

        const [ topic ] = container.querySelectorAll<Topic>("me-tpc");
        delete (topic.nodeObj as NodeObj & { memo?: string }).memo;
        renderMemoMarkers(container);

        expect(markedNodes(container)).toEqual([]);
    });

    it("stays on a node through being selected, which rewrites what the node wears", () => {
        // Selecting a node sets its `className` outright — Mind Elixir writes "selected" over
        // whatever was there — and unselecting takes only that word off again. A mark held as a
        // class went with the first click and stayed gone until the map was next laid out, which is
        // to say the dot vanished the moment anyone touched the node it was telling them about.
        const container = buildMap({ memo: "<p>About it</p>" } as Partial<NodeObj>);
        renderMemoMarkers(container);

        const [ topic ] = container.querySelectorAll<Topic>("me-tpc");
        topic.className = "selected";
        expect(markedNodes(container)).toEqual([ "n0" ]);

        topic.classList.remove("selected");
        expect(markedNodes(container)).toEqual([ "n0" ]);
    });

    it("passes over a node that has yet to be given the one it stands for", () => {
        const container = document.createElement("div");
        container.appendChild(document.createElement("me-tpc"));

        expect(() => renderMemoMarkers(container)).not.toThrow();
        expect(container.querySelector("me-tpc")?.hasAttribute(MEMO_MARKER_ATTRIBUTE)).toBe(false);
    });
});
