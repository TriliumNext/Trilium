import { describe, expect, it } from "vitest";

import { expandCollapsedAncestors } from "./collapsibles.js";

/** Builds a `<details>` element (optionally closed) with the given children appended. */
function makeDetails(open: boolean, ...children: Element[]): HTMLDetailsElement {
    const details = document.createElement("details");
    details.className = "trilium-collapsible";
    details.open = open;
    for (const child of children) {
        details.appendChild(child);
    }
    return details;
}

describe("expandCollapsedAncestors", () => {
    it("opens every closed <details> ancestor and returns true", () => {
        const leaf = document.createElement("span");
        const innerDetails = makeDetails(false, leaf);
        const outerDetails = makeDetails(false, innerDetails);
        document.body.appendChild(outerDetails);

        const result = expandCollapsedAncestors(leaf);

        expect(result).toBe(true);
        expect(innerDetails.open).toBe(true);
        expect(outerDetails.open).toBe(true);

        outerDetails.remove();
    });

    it("leaves already-open ancestors untouched and returns false", () => {
        const leaf = document.createElement("span");
        const innerDetails = makeDetails(true, leaf);
        const outerDetails = makeDetails(true, innerDetails);
        document.body.appendChild(outerDetails);

        const result = expandCollapsedAncestors(leaf);

        expect(result).toBe(false);
        expect(innerDetails.open).toBe(true);
        expect(outerDetails.open).toBe(true);

        outerDetails.remove();
    });

    it("returns false and does nothing for an element outside any <details>", () => {
        const el = document.createElement("span");
        document.body.appendChild(el);

        expect(expandCollapsedAncestors(el)).toBe(false);

        el.remove();
    });

    it("opens only the closed ancestors in a mixed open/closed chain", () => {
        const leaf = document.createElement("span");
        // Innermost is open, middle is closed, outermost is open.
        const innerDetails = makeDetails(true, leaf);
        const middleDetails = makeDetails(false, innerDetails);
        const outerDetails = makeDetails(true, middleDetails);
        document.body.appendChild(outerDetails);

        const result = expandCollapsedAncestors(leaf);

        expect(result).toBe(true);
        expect(innerDetails.open).toBe(true);
        expect(middleDetails.open).toBe(true);
        expect(outerDetails.open).toBe(true);

        outerDetails.remove();
    });

    it("expands the element itself when it is a closed <details>, plus closed ancestors", () => {
        // el.closest("details") matches el itself when el is a <details>.
        const innerDetails = makeDetails(false);
        const outerDetails = makeDetails(false, innerDetails);
        document.body.appendChild(outerDetails);

        const result = expandCollapsedAncestors(innerDetails);

        expect(result).toBe(true);
        expect(innerDetails.open).toBe(true);
        expect(outerDetails.open).toBe(true);

        outerDetails.remove();
    });

    it("handles a raw imported <details> nested inside another <details>", () => {
        const leaf = document.createElement("p");
        const rawDetails = document.createElement("details"); // no trilium-collapsible class
        rawDetails.open = false;
        rawDetails.appendChild(leaf);
        const outerCollapsible = makeDetails(false, rawDetails);
        document.body.appendChild(outerCollapsible);

        const result = expandCollapsedAncestors(leaf);

        expect(result).toBe(true);
        expect(rawDetails.open).toBe(true);
        expect(outerCollapsible.open).toBe(true);

        outerCollapsible.remove();
    });
});
