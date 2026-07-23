import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FindInHtml from "./find_in_html.js";

/**
 * Builds a FindInHtml wired to a real (happy-dom) content element, so mark.js can mutate it.
 */
function setup(html: string) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.innerHTML = html;
    document.body.appendChild(container);

    const parent = {
        noteContext: {
            getContentElement: async () => $(container)
        }
    } as any;

    return { finder: new FindInHtml(parent), container };
}

describe("FindInHtml", () => {
    beforeEach(() => {
        // happy-dom doesn't implement scrollIntoView; jumpTo() calls it.
        (Element.prototype as any).scrollIntoView = vi.fn();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("marks the seed term with the primary find-result class and counts matches", async () => {
        const { finder, container } = setup("<p>alpha beta alpha gamma</p>");

        const result = await finder.performFind("alpha", false, false);

        expect(result.totalFound).toBe(2);
        expect(result.currentFound).toBe(1);
        expect(container.querySelectorAll(".ck-find-result").length).toBe(2);
        expect(container.querySelectorAll(".find-result-secondary").length).toBe(0);
    });

    it("highlightExtraTokens marks non-seed tokens with the muted secondary class only", async () => {
        const { finder, container } = setup("<p>alpha beta gamma</p>");

        await finder.performFind("alpha", false, false);
        await finder.highlightExtraTokens([ "beta", "gamma" ]);

        // Seed count is unaffected — Enter/F3 still cycles only the primary matches.
        expect(container.querySelectorAll(".ck-find-result").length).toBe(1);
        expect(container.querySelectorAll(".find-result-secondary").length).toBe(2);
    });

    it("findBoxClosed unmarks the shared instance once, clearing primary + secondary together", async () => {
        const { finder, container } = setup("<p>alpha beta gamma</p>");

        await finder.performFind("alpha", false, false);
        await finder.highlightExtraTokens([ "beta" ]);
        expect(container.querySelectorAll(".ck-find-result, .find-result-secondary").length).toBe(2);

        // Secondary marks reuse the same mark.js instance as the seed pass, so a single unmark()
        // in findBoxClosed clears both. (happy-dom can't actually unwrap mark.js spans, so the
        // cleanup is asserted at the call level rather than via the DOM.)
        const markInstance = (finder as unknown as { mark: { unmark: () => void } }).mark;
        const unmarkSpy = vi.spyOn(markInstance, "unmark");

        await finder.findBoxClosed(1, 0);

        expect(unmarkSpy).toHaveBeenCalledTimes(1);
    });

    it("highlightExtraTokens is a no-op before a find has run (no mark instance yet)", async () => {
        const { finder, container } = setup("<p>alpha beta</p>");

        await finder.highlightExtraTokens([ "beta" ]);

        expect(container.querySelectorAll(".find-result-secondary").length).toBe(0);
    });

    it("highlightExtraTokens safely handles tokens containing regex metacharacters", async () => {
        const { finder, container } = setup("<p>a.c a+c value</p>");

        await finder.performFind("value", false, false);
        await finder.highlightExtraTokens([ "a.c", "a+c" ]);

        // Literal matches only — no regex injection (both literal tokens exist once each).
        const secondary = Array.from(container.querySelectorAll(".find-result-secondary")).map((el) => el.textContent);
        expect(secondary).toContain("a.c");
        expect(secondary).toContain("a+c");
    });
});
