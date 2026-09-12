import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Popover from "./Popover";

/**
 * Growing an anchored card to fill the window (see `maximized` in Popover), which is a way the same
 * card is drawn and not a surface put up in its place. What that buys is the point of these: a note
 * being edited within the card lives across the change, where a dialog raised instead would tear
 * the editor down and build it again with whatever was typed still unsaved.
 */
describe("Popover, maximized", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        document.body.innerHTML = "";
    });

    const anchorRect = () => new DOMRect(100, 100, 50, 20);

    /**
     * Drawn, and then given the turn of the loop Popper places a card in: `createPopper` schedules
     * its first placement rather than doing it there and then, so the attribute that says where the
     * card ended up is not on it until the microtasks have run out.
     */
    async function mount(maximized: boolean) {
        await act(async () => {
            render(
                <Popover getAnchorRect={anchorRect} maximized={maximized}>
                    <div className="held-content" />
                </Popover>,
                container);
            await Promise.resolve();
        });
    }

    const popover = () => document.querySelector<HTMLElement>(".tn-popover");
    const backdrop = () => document.querySelector<HTMLElement>(".tn-popover-backdrop");
    const held = () => document.querySelector<HTMLElement>(".held-content");

    it("keeps what it holds across the change, rather than building it again", async () => {
        await mount(false);
        const before = held();
        expect(before).toBeTruthy();

        await mount(true);
        expect(held()).toBe(before);

        // And back down again: the card is anchored once more and what it holds has still never
        // been away.
        await mount(false);
        expect(held()).toBe(before);
    });

    it("lets go of the anchor as it grows, and takes hold again as it comes down", async () => {
        await mount(false);
        // Popper places the card and says where it ended up; the styling of a grown card waits on
        // that attribute being gone (see the `.maximized` rules in Popover.css).
        expect(popover()?.getAttribute("data-popper-placement")).toBeTruthy();

        await mount(true);
        expect(popover()?.classList.contains("maximized")).toBe(true);
        // Given back as the popper is destroyed, along with the inline placement it wrote — which
        // is what leaves the stylesheet free to put the card where it likes.
        expect(popover()?.hasAttribute("data-popper-placement")).toBe(false);
        expect(popover()?.style.transform).toBe("");

        await mount(false);
        expect(popover()?.classList.contains("maximized")).toBe(false);
        expect(popover()?.getAttribute("data-popper-placement")).toBeTruthy();
    });

    it("dims the page only while it is grown", async () => {
        await mount(false);
        expect(backdrop()).toBeNull();

        await mount(true);
        // A sibling of the card and not a child: the card carries a backdrop filter, which would
        // make it the containing block of anything fixed within it (see Popover.css).
        expect(backdrop()).toBeTruthy();
        expect(backdrop()?.contains(popover() ?? null)).toBe(false);

        await mount(false);
        expect(backdrop()).toBeNull();
    });
});
