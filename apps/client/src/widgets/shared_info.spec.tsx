import { describe, expect, it } from "vitest";

import { buildShareLinkHtml } from "./shared_info";

describe("buildShareLinkHtml", () => {
    it("keeps the whole link in the anchor's href and text, whatever characters it carries", () => {
        const link = `http://host/share/my alias"x`;
        const anchor = parseAnchor(buildShareLinkHtml(link));

        expect(anchor.getAttribute("href")).toBe(link);
        expect(anchor.textContent).toBe(link);
        expect(anchor.getAttributeNames().sort()).toEqual([ "class", "href" ]);
    });
});

function parseAnchor(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;

    const anchor = container.querySelector("a");
    if (!anchor) {
        throw new Error(`No anchor in ${html}`);
    }

    return anchor;
}
